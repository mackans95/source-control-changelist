import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { change, repository } from './fakes.ts'
import { Status } from '../src/constants/git.ts'
import {
	changelistOf,
	claimNewChanges,
	groupChanges,
	pruneChangelists,
	unlistedChanges,
	listsOf,
	trackHunks,
} from '../src/model/changelists.ts'
import type { Hunk, RepositoryChangelists } from '#types/extension.ts'

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

describe('claimNewChanges', () => {
	const [a, b, c] = ['a.ts', 'b.ts', 'c.ts'].map(name => `file:///repo/${name}`)
	const active = { lists: ['Feature', 'Later'], files: { [b]: 'Later' }, active: 'Feature' }

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

describe('unlistedChanges', () => {
	test("takes the unstaged changes that aren't in a list, with the conflicts", () => {
		const conflict = change('c.ts', Status.BOTH_MODIFIED)
		const tracked = change('a.ts')
		const moved = change('b.ts')
		const untracked = change('new.ts', Status.UNTRACKED)
		const repo = repository({
			merge: [conflict],
			staged: [change('s.ts', Status.INDEX_MODIFIED)],
			changes: [tracked, moved],
			untracked: [untracked],
		})
		const changelists = { lists: ['Feature'], files: { [moved.uri.toString()]: 'Feature' } }
		assert.deepEqual(unlistedChanges(repo, changelists), [conflict, tracked, untracked])
	})
})

describe('trackHunks and split files', () => {
	const file = change('a.ts')
	const uri = file.uri.toString()
	const top: Hunk = { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-3', '+three'] }
	const bottom: Hunk = { oldStart: 20, oldLines: 1, newStart: 20, newLines: 1, lines: ['-20', '+twenty'] }
	const base: RepositoryChangelists = { lists: ['Feature', 'Later'], files: { [uri]: 'Feature' } }
	const split: RepositoryChangelists = {
		...base,
		hunks: { [uri]: { head: 'abc', hunks: [{ oldStart: 20, oldLines: 1, text: '-20\n+twenty', list: 'Later' }] } },
	}

	test('splits a file when a new change goes to the active list', () => {
		const tracked = trackHunks(
			{ ...base, active: 'Later' },
			new Map([[uri, [top, bottom]]]),
			new Map([[uri, [top]]]),
			'abc',
		)
		assert.deepEqual(tracked.files, { [uri]: 'Feature' })
		assert.deepEqual(tracked.hunks, split.hunks)
	})
	test('shows a split file in each of its lists', () => {
		const repo = repository({ changes: [file] })
		assert.deepEqual(listsOf(split, file), ['Feature', 'Later'])
		assert.deepEqual(groupChanges(repo, 'changes', split, 'Feature'), [file])
		assert.deepEqual(groupChanges(repo, 'changes', split, 'Later'), [file])
		assert.deepEqual(groupChanges(repo, 'changes', split), [])
	})
	test('moves the file to the list all of its changes are in', () => {
		const tracked = trackHunks(split, new Map([[uri, [bottom]]]), new Map([[uri, [bottom]]]), 'abc')
		assert.deepEqual(tracked.files, { [uri]: 'Later' })
		assert.equal(tracked.hunks, undefined)
	})
	test("puts a deleted list's changes back in their file's list", () => {
		const tracked = trackHunks({ ...split, lists: ['Feature'] }, new Map([[uri, [top, bottom]]]), new Map(), 'abc')
		assert.deepEqual(tracked.files, { [uri]: 'Feature' })
		assert.equal(tracked.hunks, undefined)
	})
	test('forgets the split of a file that has no changes any more', () => {
		assert.equal(trackHunks(split, new Map(), new Map(), 'abc').hunks, undefined)
		assert.equal(pruneChangelists(repository({}), split).hunks, undefined)
	})
})
