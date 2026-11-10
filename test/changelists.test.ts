import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { change, repository } from './fakes.ts'
import { Status } from '../src/constants/git.ts'
import { changelistOf, claimNewChanges, groupChanges, pruneChangelists } from '../src/model/changelists.ts'

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
