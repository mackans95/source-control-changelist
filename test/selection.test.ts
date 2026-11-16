import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { change, repository, uri } from './fakes.ts'
import { groupsOf } from '../src/commands/nodes.ts'
import { selectedTargets } from '../src/view/selection.ts'
import type { FolderNode, GroupNode, ResourceNode } from '#types/extension.ts'

describe('selectedTargets', () => {
	const a = { repository: 'file:///repo', kind: 'changes', uri: 'file:///repo/a.ts' } as const
	const b = { repository: 'file:///repo', kind: 'changes', changelist: 'Feature', uri: 'file:///repo/b.ts' } as const
	const c = { repository: 'file:///repo', kind: 'changes', uri: 'file:///repo/c.ts' } as const

	test('runs on all the selected rows when the row is one of them', () => {
		assert.deepEqual(selectedTargets([a, b], b), [a, b])
	})
	test("runs on the row alone when it isn't selected", () => {
		assert.deepEqual(selectedTargets([a, b], c), [c])
	})
	test("finds the row from a right-click menu's context, which has more fields", () => {
		const menu = { ...b, webviewSection: 'file', preventDefaultContextMenuItems: true } as const
		assert.deepEqual(selectedTargets([a, b], menu), [a, b])
	})
	test('tells a list apart from Changes', () => {
		assert.deepEqual(selectedTargets([a, b], { ...b, changelist: undefined }), [{ ...b, changelist: undefined }])
	})
})

describe('groupsOf', () => {
	const repo = repository({})
	const [a, b, c] = [change('src/a.ts'), change('src/b.ts'), change('c.ts')]
	const file = (fileChange: typeof a, changelist?: string): ResourceNode => ({
		type: 'resource',
		repository: repo,
		kind: 'changes',
		changelist,
		change: fileChange,
	})
	const folder: FolderNode = {
		type: 'folder',
		repository: repo,
		kind: 'changes',
		uri: uri('/repo/src'),
		label: 'src',
		changes: [a, b],
		children: [],
	}
	const staged: GroupNode = { type: 'group', repository: repo, kind: 'staged', changes: [c] }

	test('merges the rows of a group into one node with each file once, also a file selected with its folder', () => {
		assert.deepEqual(groupsOf([file(a), folder, file(c)], ['changes']), [
			{ type: 'group', repository: repo, kind: 'changes', changelist: undefined, changes: [a, b, c] },
		])
	})
	test('keeps the lists and the groups apart', () => {
		const groups = groupsOf([file(a), file(b, 'Feature'), staged], ['changes', 'staged'])
		assert.deepEqual(
			groups.map(group => [group.kind, group.changelist, group.changes]),
			[
				['changes', undefined, [a]],
				['changes', 'Feature', [b]],
				['staged', undefined, [c]],
			],
		)
	})
	test("leaves out the groups the command doesn't take files from", () => {
		assert.deepEqual(groupsOf([staged], ['changes']), [])
	})
})
