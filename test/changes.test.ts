import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { change, repository } from './fakes.ts'
import { Status } from '../src/constants/git.ts'
import { changedUris, countChanges, getChanges, hasChanges } from '../src/model/changes.ts'

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

describe('changedUris', () => {
	const a = 'file:///repo/a.ts'

	test('lists every changed file, staged or not', () => {
		const staged = change('s.ts', Status.INDEX_MODIFIED)
		const untracked = change('u.ts', Status.UNTRACKED)
		const changed = changedUris(repository({ staged: [staged], changes: [change('a.ts')], untracked: [untracked] }))
		assert.deepEqual([...changed].sort(), [a, staged.uri.toString(), untracked.uri.toString()].sort())
	})
})
