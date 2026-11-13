import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type * as vscode from 'vscode'
import { toRepositoryItem, toSyncRepositoryItem } from '../src/view/items.ts'
import { Status } from '../src/constants/git.ts'
import type { FileDiff, Hunk, IconResolver, RepositoryChangelists } from '../src/types/extension.ts'
import type { Branch, Change, Repository } from '../src/types/git.ts'

// Just enough of a URI for a repository's root.
function uri(path: string): vscode.Uri {
	return { path, fsPath: path, toString: () => `file://${path}` } as never
}

// A repository whose HEAD is this branch, or a detached HEAD without one, and these uncommitted changes.
function onBranch(head: Partial<Branch> | undefined, workingTreeChanges: Change[] = []): Repository {
	return {
		rootUri: uri('/code/api'),
		state: { HEAD: head, mergeChanges: [], indexChanges: [], workingTreeChanges, untrackedChanges: [] },
	} as never
}

const upstream = { remote: 'origin', name: 'main' }
// No file icon theme.
const icons: IconResolver = { fonts: () => [], file: () => undefined, folder: () => undefined }

describe('toSyncRepositoryItem', () => {
	test('has the repository, its branch and how far that is from its upstream', () => {
		assert.deepEqual(toSyncRepositoryItem(onBranch({ name: 'main', upstream, ahead: 2, behind: 1 }), []), {
			id: 'file:///code/api',
			name: 'api',
			path: '/code/api',
			kind: 'repository',
			worktreeOf: undefined,
			branch: 'main',
			state: 'diverged',
			ahead: 2,
			behind: 1,
			needsSync: true,
			hasChanges: false,
			parentId: undefined,
		})
	})
	test('treats missing counts as none', () => {
		const item = toSyncRepositoryItem(onBranch({ name: 'feature' }), [])
		assert.equal(item.state, 'unpublished')
		assert.equal(item.ahead, 0)
		assert.equal(item.behind, 0)
		assert.equal(item.needsSync, false)
	})
	test('shows the short commit for a detached HEAD, and nothing before the first commit', () => {
		assert.equal(toSyncRepositoryItem(onBranch({ commit: '0123456789abcdef' }), []).branch, '01234567')
		assert.equal(toSyncRepositoryItem(onBranch(undefined), []).branch, '')
	})
	test('knows when there are uncommitted changes', () => {
		const change = { uri: uri('/code/api/a.ts') } as Change
		assert.equal(toSyncRepositoryItem(onBranch({ name: 'main', upstream }, [change]), []).hasChanges, true)
	})
	test('knows a worktree and the repository it belongs to', () => {
		const repository = {
			rootUri: uri('/code/feature-x'),
			kind: 'worktree',
			state: {
				worktrees: [{ path: '/code/api', main: true }],
				mergeChanges: [],
				indexChanges: [],
				workingTreeChanges: [],
				untrackedChanges: [],
			},
		} as never
		const item = toSyncRepositoryItem(repository, [onBranch(undefined), repository])
		assert.equal(item.kind, 'worktree')
		assert.equal(item.worktreeOf, 'api')
		assert.equal(item.parentId, 'file:///code/api')
		assert.equal(toSyncRepositoryItem(repository, [repository]).parentId, undefined)
	})
})

describe('toRepositoryItem', () => {
	test('shows the changelists after Changes, also the empty ones', () => {
		const tracked = { uri: uri('/code/api/a.ts'), status: Status.MODIFIED } as Change
		const moved = { uri: uri('/code/api/b.ts'), status: Status.MODIFIED } as Change
		const changelists = { lists: ['Feature', 'Later'], files: { [moved.uri.toString()]: 'Feature' } }
		const item = toRepositoryItem(onBranch({ name: 'main' }, [tracked, moved]), changelists, 'list', icons)
		assert.deepEqual(
			item.groups.map(group => [group.label, group.count]),
			[
				['Changes', 1],
				['Feature', 1],
				['Later', 0],
			],
		)
		assert.equal(item.groups[1].id, 'file:///code/api#changelist#Feature')
		assert.equal(item.groups[1].changelist, 'Feature')
	})
})

describe('a split file with staged changes', () => {
	const working = { uri: uri('/code/api/big.ts'), status: Status.MODIFIED } as Change
	const staged = { uri: uri('/code/api/big.ts'), status: Status.INDEX_MODIFIED } as Change
	const top: Hunk = { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-3', '+three'] }
	const bottom: Hunk = { oldStart: 20, oldLines: 1, newStart: 20, newLines: 1, lines: ['-20', '+twenty'] }
	// Line 3 is in Changes, the file's list, and line 20 in Feature.
	const changelists: RepositoryChangelists = {
		lists: ['Feature'],
		files: {},
		hunks: {
			[working.uri.toString()]: {
				head: 'abc',
				hunks: [{ oldStart: 20, oldLines: 1, text: '-20\n+twenty', list: 'Feature' }],
			},
		},
	}
	// Each group with how much of it is staged, and its row's staged state and other lists.
	const rows = (changes: { working?: boolean; staged: Hunk[]; unstaged: Hunk[] }) => {
		const repository = {
			rootUri: uri('/code/api'),
			state: {
				HEAD: { name: 'main', commit: 'abc' },
				mergeChanges: [],
				indexChanges: [staged],
				workingTreeChanges: changes.working === false ? [] : [working],
				untrackedChanges: [],
			},
		} as never as Repository
		const diff: FileDiff = { hunks: [top, bottom], staged: changes.staged, unstaged: changes.unstaged }
		const item = toRepositoryItem(repository, changelists, 'list', icons, () => diff)
		return item.groups.map(group => [
			`${group.label} (${group.staged})`,
			group.children.map(file =>
				file.type === 'file' ? `${file.staged} ${file.otherLists.join(',')}`.trim() : '',
			),
		])
	}

	test("keeps a list's staged part in the list, and leaves Changes when its part is staged too", () => {
		assert.deepEqual(rows({ working: false, staged: [top, bottom], unstaged: [] }), [
			['Staged Changes (none)', ['none']],
			['Feature (all)', ['all']],
		])
	})
	test("takes the file out of Changes when only Changes' part is staged", () => {
		assert.deepEqual(rows({ staged: [top], unstaged: [bottom] }), [
			['Staged Changes (none)', ['none']],
			['Feature (none)', ['none']],
		])
	})
	test("shows a list's part as staged when only it is", () => {
		assert.deepEqual(rows({ staged: [bottom], unstaged: [top] }), [
			['Staged Changes (none)', ['none']],
			['Changes (none)', ['none Feature']],
			['Feature (all)', ['all Changes']],
		])
	})
})
