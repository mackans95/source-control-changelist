import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type * as vscode from 'vscode'
import { buildTree, byPath, countChanges, getChanges, hasChanges, repositoryName } from '../src/changelistModel.ts'
import { Status } from '../src/constants/git.ts'
import type { Change, Repository } from '../src/types/git.ts'
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
})
