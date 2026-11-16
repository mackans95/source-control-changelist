import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { change, repository } from './fakes.ts'
import { discardQuestion } from '../src/commands/discardQuestion.ts'
import { Status } from '../src/constants/git.ts'
import type { GroupNode } from '#types/extension.ts'
import type { Change } from '#types/git.ts'
import type { GroupKind } from '#types/shared.ts'

describe('discardQuestion', () => {
	const repo = repository({})
	const group = (kind: GroupKind, changes: Change[], changelist?: string): GroupNode => ({
		type: 'group',
		repository: repo,
		kind,
		changelist,
		changes,
	})
	const [a, b] = [change('a.ts'), change('b.ts')]
	const added = change('new.ts', Status.UNTRACKED)

	test('asks about one file by name', () => {
		assert.equal(
			discardQuestion([group('changes', [a])], false),
			'Are you sure you want to discard changes in a.ts?',
		)
	})
	test("says when a split file loses only its list's changes", () => {
		assert.equal(
			discardQuestion([group('changes', [a], 'Feature')], true),
			'Are you sure you want to discard the changes in a.ts that are in Feature?',
		)
		assert.equal(
			discardQuestion([group('changes', [a])], true),
			'Are you sure you want to discard the changes in a.ts that are in Changes?',
		)
	})
	test('warns that an untracked file is deleted, in Untracked Changes or in a list', () => {
		const question = 'Are you sure you want to DELETE new.ts? This is IRREVERSIBLE!'
		assert.equal(discardQuestion([group('untracked', [added])], false), question)
		assert.equal(discardQuestion([group('changes', [added], 'Feature')], false), question)
	})
	test('counts the files in every group', () => {
		assert.equal(
			discardQuestion([group('changes', [a]), group('changes', [b], 'Feature')], false),
			'Are you sure you want to discard ALL changes in 2 files? This is IRREVERSIBLE!',
		)
	})
	test('counts the untracked files on their own', () => {
		assert.equal(
			discardQuestion([group('untracked', [added, change('other.ts', Status.UNTRACKED)])], false),
			'Are you sure you want to DELETE 2 untracked files? This is IRREVERSIBLE!',
		)
	})
	test('counts the files it discards and the ones it deletes', () => {
		assert.equal(
			discardQuestion([group('changes', [a, added]), group('changes', [b], 'Feature')], false),
			'Are you sure you want to discard ALL changes in 2 files and DELETE 1 untracked file? This is IRREVERSIBLE!',
		)
	})
})
