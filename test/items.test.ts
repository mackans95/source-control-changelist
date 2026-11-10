import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type * as vscode from 'vscode'
import { toRepositoryItem, toSyncRepositoryItem } from '../src/view/items.ts'
import { Status } from '../src/constants/git.ts'
import type { IconResolver } from '../src/types/extension.ts'
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
