import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { themeColor, canDropChanges } from '../src/helpers/shared.ts'

describe('themeColor', () => {
	test('turns a theme color ID into the CSS variable webviews have for it', () => {
		assert.equal(
			themeColor('gitDecoration.addedResourceForeground'),
			'var(--vscode-gitDecoration-addedResourceForeground)',
		)
	})

	test('replaces every dot', () => {
		assert.equal(themeColor('a.b.c'), 'var(--vscode-a-b-c)')
	})
})

describe('canDropChanges', () => {
	const repository = 'file:///repo'
	const changes = { repository, kind: 'changes' } as const
	const untracked = { repository, kind: 'untracked' } as const
	const staged = { repository, kind: 'staged' } as const
	const feature = { repository, kind: 'changes', changelist: 'Feature' } as const
	const later = { repository, kind: 'changes', changelist: 'Later' } as const

	test('moves files into a changelist from anywhere else', () => {
		for (const from of [changes, untracked, staged, later]) {
			assert.equal(canDropChanges(from, feature), true)
		}
		assert.equal(canDropChanges(feature, feature), false)
	})
	test('takes files out of a list onto Changes or Untracked Changes, but not between those two', () => {
		assert.equal(canDropChanges(feature, changes), true)
		assert.equal(canDropChanges(feature, untracked), true)
		assert.equal(canDropChanges(changes, untracked), false)
		assert.equal(canDropChanges(untracked, changes), false)
	})
	test('stages onto Staged Changes, and unstages onto Changes', () => {
		assert.equal(canDropChanges(changes, staged), true)
		assert.equal(canDropChanges(feature, staged), true)
		assert.equal(canDropChanges(staged, staged), false)
		assert.equal(canDropChanges(staged, changes), true)
		assert.equal(canDropChanges(staged, untracked), false)
	})
	test('leaves Merge Changes and other repositories alone', () => {
		assert.equal(canDropChanges({ repository, kind: 'merge' }, feature), false)
		assert.equal(canDropChanges(changes, { repository, kind: 'merge' }), false)
		assert.equal(canDropChanges(changes, { ...feature, repository: 'file:///other' }), false)
	})
})
