import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type * as vscode from 'vscode'
import { toSyncRepositoryItem } from '../src/changelistItems.ts'
import type { Branch, Repository } from '../src/types/git.ts'

// Just enough of a URI for a repository's root.
function uri(path: string): vscode.Uri {
	return { path, fsPath: path, toString: () => `file://${path}` } as never
}

// A clean repository whose HEAD is this branch, or a detached HEAD without one.
function onBranch(head: Partial<Branch> | undefined): Repository {
	return { rootUri: uri('/code/api'), state: { HEAD: head } } as never
}

const upstream = { remote: 'origin', name: 'main' }

describe('toSyncRepositoryItem', () => {
	test('has the repository, its branch and how far that is from its upstream', () => {
		assert.deepEqual(toSyncRepositoryItem(onBranch({ name: 'main', upstream, ahead: 2, behind: 1 })), {
			id: 'file:///code/api',
			name: 'api',
			path: '/code/api',
			branch: 'main',
			state: 'diverged',
			ahead: 2,
			behind: 1,
			needsSync: true,
		})
	})
	test('treats missing counts as none', () => {
		const item = toSyncRepositoryItem(onBranch({ name: 'feature' }))
		assert.equal(item.state, 'unpublished')
		assert.equal(item.ahead, 0)
		assert.equal(item.behind, 0)
		assert.equal(item.needsSync, false)
	})
	test('shows the short commit for a detached HEAD, and nothing before the first commit', () => {
		assert.equal(toSyncRepositoryItem(onBranch({ commit: '0123456789abcdef' })).branch, '01234567')
		assert.equal(toSyncRepositoryItem(onBranch(undefined)).branch, '')
	})
})
