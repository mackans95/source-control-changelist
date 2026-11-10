import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type * as vscode from 'vscode'
import {
	applyOrder,
	buildTree,
	byName,
	byPath,
	changelistOf,
	changedUris,
	claimNewChanges,
	countChanges,
	folderIndex,
	getChanges,
	gitErrorMessage,
	groupChanges,
	hasChanges,
	mainRepositoryPath,
	moveInOrder,
	needsSync,
	needsPull,
	pruneChangelists,
	repositoryName,
	syncState,
	sortRepositories,
} from '../src/changelistModel.ts'
import { Status } from '../src/constants/git.ts'
import type { Branch, Change, Repository } from '../src/types/git.ts'
import type { FolderNode, ResourceNode } from '../src/types/extension.ts'

// Just enough of a URI for the model, which only reads `path` and `fsPath` and makes folders with `with`.
function uri(path: string): vscode.Uri {
	return {
		path,
		fsPath: path,
		with: ({ path }: { path: string }) => uri(path),
		toString: () => `file://${path}`,
	} as never
}

function change(path: string, status: (typeof Status)[keyof typeof Status] = Status.MODIFIED): Change {
	return { uri: uri(`/repo/${path}`), originalUri: uri(`/repo/${path}`), renameUri: undefined, status }
}

function repository(groups: {
	merge?: Change[]
	staged?: Change[]
	changes?: Change[]
	untracked?: Change[]
}): Repository {
	return {
		rootUri: uri('/repo'),
		state: {
			mergeChanges: groups.merge ?? [],
			indexChanges: groups.staged ?? [],
			workingTreeChanges: groups.changes ?? [],
			untrackedChanges: groups.untracked ?? [],
		},
	} as never
}

// A clean repository whose HEAD is this branch, or a detached HEAD without one.
function onBranch(head: Partial<Branch> | undefined, path = '/repo'): Repository {
	return { rootUri: uri(path), state: { HEAD: head } } as never
}

// A worktree in its own folder, of the repository in `main`.
function worktree(path: string, main: string): Repository {
	return { rootUri: uri(path), kind: 'worktree', state: { worktrees: [{ path: main, main: true }] } } as never
}

const upstream = { remote: 'origin', name: 'main' }

// The tree as nested labels: a folder as `{ label: children }`, a file as its name.
function shape(nodes: readonly (FolderNode | ResourceNode)[]): unknown[] {
	return nodes.map(n =>
		n.type === 'folder' ? { [n.label]: shape(n.children) } : n.change.uri.path.split('/').pop()!,
	)
}

describe('getChanges and hasChanges', () => {
	const staged = change('a.ts', Status.INDEX_MODIFIED)
	const untracked = change('b.ts', Status.UNTRACKED)
	const repo = repository({ staged: [staged], untracked: [untracked] })

	test('reads each group from its own list', () => {
		assert.deepEqual(getChanges(repo, 'staged'), [staged])
		assert.deepEqual(getChanges(repo, 'untracked'), [untracked])
		assert.deepEqual(getChanges(repo, 'changes'), [])
	})
	test('has changes when any group has', () => {
		assert.equal(hasChanges(repo), true)
		assert.equal(hasChanges(repository({ merge: [change('c.ts', Status.BOTH_MODIFIED)] })), true)
	})
	test('has no changes when every group is empty', () => {
		assert.equal(hasChanges(repository({})), false)
	})
})

describe('countChanges', () => {
	test('counts each category', () => {
		const repo = repository({
			staged: [change('a.ts', Status.INDEX_ADDED), change('b.ts', Status.INDEX_DELETED)],
			changes: [change('c.ts'), change('d.ts', Status.TYPE_CHANGED), change('e.ts', Status.DELETED)],
			untracked: [change('f.ts', Status.UNTRACKED)],
		})
		assert.deepEqual(countChanges(repo), { added: 2, modified: 2, deleted: 2, conflict: 0 })
	})
	test('counts a file in two groups once, under its strongest category', () => {
		const repo = repository({
			staged: [change('a.ts', Status.INDEX_ADDED), change('b.ts', Status.INDEX_MODIFIED)],
			changes: [change('a.ts'), change('b.ts', Status.DELETED)],
		})
		assert.deepEqual(countChanges(repo), { added: 1, modified: 0, deleted: 1, conflict: 0 })
	})
	test('counts conflicts above everything else', () => {
		const repo = repository({
			merge: [change('a.ts', Status.BOTH_MODIFIED)],
			staged: [change('a.ts', Status.INDEX_ADDED)],
		})
		assert.deepEqual(countChanges(repo), { added: 0, modified: 0, deleted: 0, conflict: 1 })
	})
	test('leaves out ignored files', () => {
		const repo = repository({ untracked: [change('a.log', Status.IGNORED)] })
		assert.deepEqual(countChanges(repo), { added: 0, modified: 0, deleted: 0, conflict: 0 })
	})
})

describe('buildTree', () => {
	const tree = (...paths: string[]) =>
		buildTree(
			repository({}),
			'changes',
			paths.map(p => change(p)),
		)

	test('puts files at the root next to the folders', () => {
		assert.deepEqual(shape(tree('README.md', 'src/a.ts')), [{ src: ['a.ts'] }, 'README.md'])
	})
	test('joins folders that only hold one folder', () => {
		assert.deepEqual(shape(tree('src/app/main/a.ts')), [{ 'src/app/main': ['a.ts'] }])
	})
	test('stops joining at a folder with files or several folders', () => {
		assert.deepEqual(shape(tree('src/a.ts', 'src/app/b.ts', 'src/lib/util/c.ts')), [
			{ src: [{ app: ['b.ts'] }, { 'lib/util': ['c.ts'] }, 'a.ts'] },
		])
	})
	test('sorts folders and files by name, folders first', () => {
		assert.deepEqual(shape(tree('b.ts', 'z/x.ts', 'a.ts', 'm/y.ts')), [
			{ m: ['y.ts'] },
			{ z: ['x.ts'] },
			'a.ts',
			'b.ts',
		])
	})
	test('gives each folder its URI and the changes below it', () => {
		const [folder] = tree('src/app/a.ts', 'src/app/deep/b.ts') as FolderNode[]
		assert.equal(folder.uri.path, '/repo/src/app')
		assert.deepEqual(
			folder.changes.map(c => c.uri.path),
			['/repo/src/app/deep/b.ts', '/repo/src/app/a.ts'],
		)
		assert.equal((folder.children[0] as FolderNode).uri.path, '/repo/src/app/deep')
	})
	test('keeps the group and repository on every node', () => {
		const [folder] = tree('src/a.ts') as FolderNode[]
		const [file] = folder.children as ResourceNode[]
		assert.equal(folder.kind, 'changes')
		assert.equal(file.kind, 'changes')
		assert.equal(file.repository, folder.repository)
	})
})

describe('syncState and needsSync', () => {
	test('compares the branch with its upstream', () => {
		assert.equal(syncState(onBranch({ name: 'main', upstream, ahead: 0, behind: 0 })), 'synced')
		assert.equal(syncState(onBranch({ name: 'main', upstream, ahead: 2, behind: 0 })), 'ahead')
		assert.equal(syncState(onBranch({ name: 'main', upstream, ahead: 0, behind: 1 })), 'behind')
		assert.equal(syncState(onBranch({ name: 'main', upstream, ahead: 2, behind: 1 })), 'diverged')
	})
	test('treats missing counts as none', () => {
		assert.equal(syncState(onBranch({ name: 'main', upstream })), 'synced')
	})
	test('knows a branch without an upstream, and a detached HEAD', () => {
		assert.equal(syncState(onBranch({ name: 'feature', ahead: 3 })), 'unpublished')
		assert.equal(syncState(onBranch({ commit: 'abc' })), 'detached')
		assert.equal(syncState(onBranch(undefined)), 'detached')
	})
	test('needs a sync with commits to push or pull', () => {
		assert.equal(needsSync(onBranch({ name: 'main', upstream, ahead: 1 })), true)
		assert.equal(needsSync(onBranch({ name: 'main', upstream, behind: 1 })), true)
		assert.equal(needsSync(onBranch({ name: 'main', upstream, ahead: 2, behind: 1 })), true)
	})
	test('needs a pull when behind or diverged', () => {
		assert.equal(needsPull(onBranch({ name: 'main', upstream, behind: 1 })), true)
		assert.equal(needsPull(onBranch({ name: 'main', upstream, ahead: 2, behind: 1 })), true)
		assert.equal(needsPull(onBranch({ name: 'main', upstream, ahead: 1 })), false)
	})
	test('needs no sync when up to date, unpublished or detached', () => {
		assert.equal(needsSync(onBranch({ name: 'main', upstream })), false)
		assert.equal(needsSync(onBranch({ name: 'feature', ahead: 3 })), false)
		assert.equal(needsSync(onBranch({ commit: 'abc' })), false)
	})
})

describe('byPath and repositoryName', () => {
	test('sorts changes by their path', () => {
		const sorted = [change('b.ts'), change('a/c.ts'), change('a.ts')].sort(byPath)
		assert.deepEqual(
			sorted.map(c => c.uri.path),
			['/repo/a.ts', '/repo/a/c.ts', '/repo/b.ts'],
		)
	})
	test('names a repository after its folder', () => {
		assert.equal(repositoryName(repository({})), 'repo')
	})
	test('sorts repositories by their name', () => {
		const sorted = [onBranch(undefined, '/b/web'), onBranch(undefined, '/a/api')].sort(byName)
		assert.deepEqual(sorted.map(repositoryName), ['api', 'web'])
	})
})

describe('mainRepositoryPath, folderIndex and sortRepositories', () => {
	test('knows the repository a worktree belongs to', () => {
		assert.equal(mainRepositoryPath(worktree('/code/feature-x', '/code/api')), '/code/api')
		assert.equal(mainRepositoryPath(onBranch(undefined, '/code/api')), undefined)
	})
	test('puts each worktree right after its repository', () => {
		const sorted = sortRepositories([
			onBranch(undefined, '/code/web'),
			worktree('/code/zz-fix', '/code/api'),
			onBranch(undefined, '/code/api'),
			worktree('/code/feature-x', '/code/api'),
		])
		assert.deepEqual(sorted.map(repositoryName), ['api', 'feature-x', 'zz-fix', 'web'])
	})
	test("sorts a worktree by its own name when its repository isn't open", () => {
		const sorted = sortRepositories([onBranch(undefined, '/code/web'), worktree('/code/feature-x', '/code/api')])
		assert.deepEqual(sorted.map(repositoryName), ['feature-x', 'web'])
	})
	test("finds a repository's folder, also when the folder is part of the repository", () => {
		const folders = ['/code/web', '/code/api/src', '/other']
		assert.equal(folderIndex(onBranch(undefined, '/code/web'), folders), 0)
		assert.equal(folderIndex(onBranch(undefined, '/code/api'), folders), 1)
		assert.equal(folderIndex(onBranch(undefined, '/other/tools'), folders), 2)
		assert.equal(folderIndex(onBranch(undefined, '/code/webapp'), folders), 3)
	})
	test("sorts repositories in the workspace's folder order, and by name within a folder", () => {
		const sorted = sortRepositories(
			[
				onBranch(undefined, '/elsewhere/a'),
				onBranch(undefined, '/code/web'),
				onBranch(undefined, '/libs/zod'),
				onBranch(undefined, '/libs/axios'),
				onBranch(undefined, '/code/api'),
			],
			['/code/web', '/libs', '/code/api'],
		)
		assert.deepEqual(sorted.map(repositoryName), ['web', 'axios', 'zod', 'api', 'a'])
	})
	test('keeps a worktree after its repository, wherever its own folder is', () => {
		const sorted = sortRepositories(
			[
				onBranch(undefined, '/code/web'),
				onBranch(undefined, '/code/api'),
				worktree('/code/feature-x', '/code/api'),
			],
			['/code/feature-x', '/code/web', '/code/api'],
		)
		assert.deepEqual(sorted.map(repositoryName), ['web', 'api', 'feature-x'])
	})
})

describe('applyOrder and moveInOrder', () => {
	const [api, web, docs, tools] = ['/code/api', '/code/web', '/code/docs', '/code/tools'].map(p =>
		onBranch(undefined, p),
	)
	const uriOf = (repository: Repository) => repository.rootUri.toString()

	test('puts repositories in the saved order', () => {
		const ordered = applyOrder([api, docs, web], [web, api, docs].map(uriOf))
		assert.deepEqual(ordered.map(repositoryName), ['web', 'api', 'docs'])
	})
	test("puts a repository that isn't in the saved order after the one it comes after", () => {
		const ordered = applyOrder([api, docs, tools, web], [web, api, tools].map(uriOf))
		assert.deepEqual(ordered.map(repositoryName), ['web', 'api', 'docs', 'tools'])
	})
	test('puts one that comes first first, and leaves out saved ones that are closed', () => {
		const ordered = applyOrder([api, web], ['file:///code/gone', uriOf(web)])
		assert.deepEqual(ordered.map(repositoryName), ['api', 'web'])
	})
	test('keeps the sorted order without a saved one', () => {
		assert.deepEqual(applyOrder([api, web], []).map(repositoryName), ['api', 'web'])
	})
	test('moves a repository before or after another', () => {
		const order = ['a', 'b', 'c', 'd']
		assert.deepEqual(moveInOrder(order, 'd', 'b', false), ['a', 'd', 'b', 'c'])
		assert.deepEqual(moveInOrder(order, 'a', 'c', true), ['b', 'c', 'a', 'd'])
		assert.deepEqual(moveInOrder(order, 'b', 'd', true), ['a', 'c', 'd', 'b'])
	})
	test('leaves the order alone when the target is itself or not in it', () => {
		assert.deepEqual(moveInOrder(['a', 'b'], 'a', 'a', true), ['a', 'b'])
		assert.deepEqual(moveInOrder(['a', 'b'], 'a', 'x', true), ['a', 'b'])
	})
	test('keeps worktrees after their repository in the saved order', () => {
		const featureX = worktree('/code/feature-x', '/code/api')
		const sorted = sortRepositories([api, web, featureX], [], [web, api].map(uriOf))
		assert.deepEqual(sorted.map(repositoryName), ['web', 'api', 'feature-x'])
	})
})

describe('changelistOf, groupChanges and pruneChangelists', () => {
	const tracked = change('a.ts')
	const moved = change('b.ts')
	const untracked = change('new.ts', Status.UNTRACKED)
	const repo = repository({ changes: [tracked, moved], untracked: [untracked] })
	const changelists = {
		lists: ['Feature'],
		files: { [moved.uri.toString()]: 'Feature', [untracked.uri.toString()]: 'Feature' },
	}

	test('puts the moved files in their changelist, also untracked ones', () => {
		assert.deepEqual(groupChanges(repo, 'changes', changelists, 'Feature'), [moved, untracked])
	})
	test('leaves the moved files out of Changes and Untracked Changes', () => {
		assert.deepEqual(groupChanges(repo, 'changes', changelists), [tracked])
		assert.deepEqual(groupChanges(repo, 'untracked', changelists), [])
	})
	test("puts a file in Changes when its changelist doesn't exist any more", () => {
		assert.equal(changelistOf({ lists: [], files: { [moved.uri.toString()]: 'Gone' } }, moved), undefined)
	})
	test('forgets the files without changes, but keeps the staged ones', () => {
		const staged = change('c.ts', Status.INDEX_MODIFIED)
		const pruned = pruneChangelists(repository({ staged: [staged] }), {
			lists: ['Feature'],
			files: { [moved.uri.toString()]: 'Feature', [staged.uri.toString()]: 'Feature' },
		})
		assert.deepEqual(pruned.files, { [staged.uri.toString()]: 'Feature' })
	})
	test('keeps the active list and the descriptions when it prunes', () => {
		const pruned = pruneChangelists(repo, { ...changelists, active: 'Feature', descriptions: { Feature: 'Add X' } })
		assert.equal(pruned.active, 'Feature')
		assert.deepEqual(pruned.descriptions, { Feature: 'Add X' })
	})
})

describe('changedUris and claimNewChanges', () => {
	const [a, b, c] = ['a.ts', 'b.ts', 'c.ts'].map(name => `file:///repo/${name}`)
	const active = { lists: ['Feature', 'Later'], files: { [b]: 'Later' }, active: 'Feature' }

	test('lists every changed file, staged or not', () => {
		const staged = change('s.ts', Status.INDEX_MODIFIED)
		const untracked = change('u.ts', Status.UNTRACKED)
		const changed = changedUris(repository({ staged: [staged], changes: [change('a.ts')], untracked: [untracked] }))
		assert.deepEqual([...changed].sort(), [a, staged.uri.toString(), untracked.uri.toString()].sort())
	})
	test('puts the files that changed since the last check in the active list', () => {
		const claimed = claimNewChanges(active, new Set([a]), new Set([a, c]))
		assert.deepEqual(claimed.files, { [b]: 'Later', [c]: 'Feature' })
	})
	test('leaves files that are in a list already where they are', () => {
		const claimed = claimNewChanges(active, new Set(), new Set([b]))
		assert.deepEqual(claimed.files, { [b]: 'Later' })
	})
	test('leaves new changes alone without an active list, or when it was deleted', () => {
		assert.deepEqual(claimNewChanges({ ...active, active: undefined }, new Set(), new Set([c])).files, {
			[b]: 'Later',
		})
		assert.deepEqual(claimNewChanges({ ...active, active: 'Gone' }, new Set(), new Set([c])).files, {
			[b]: 'Later',
		})
	})
})

describe('gitErrorMessage', () => {
	test("picks Git's fatal line over its hints", () => {
		const stderr = [
			'hint: You have divergent branches and need to specify how to reconcile them.',
			'hint:   git config pull.rebase false  # merge',
			'fatal: Need to specify how to reconcile divergent branches.',
		].join('\n')
		assert.equal(gitErrorMessage({ stderr }), 'Need to specify how to reconcile divergent branches.')
	})
	test("uses the error's message when Git said nothing", () => {
		assert.equal(gitErrorMessage(new Error('Failed to execute git')), 'Failed to execute git')
	})
})
