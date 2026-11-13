// A file split between Changes and a list: big.ts changes line 3, which stays in Changes, and line 20,
// which is moved to Feature from the editor.
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { answer, numbered, repository, run, scenario } from './harness.ts'
import type { TestRepository } from './harness.ts'

export const partialChangelistScenarios = [
	scenario("A list's diff of a split file shows only the list's change", async () => {
		const repo = await splitFile()

		await run('openChange', repo.row({ kind: 'changes', changelist: 'Feature', file: 'big.ts' }))
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
		assert.ok(input instanceof vscode.TabInputTextDiff, 'a diff opened')
		const left = await vscode.workspace.openTextDocument(input.original)

		// The left side is HEAD with the other lists' changes, so only line 20 differs.
		assert.equal(left.getText(), numbered({ 3: 'three' }))
	}),
	scenario("Stage on a list's row stages only its change", async () => {
		const repo = await splitFile()

		await run('stage', repo.row({ kind: 'changes', changelist: 'Feature', file: 'big.ts' }))

		assert.deepEqual(repo.staged('big.ts'), ['twenty'])
		assert.deepEqual(repo.unstaged('big.ts'), ['three'])
	}),
	scenario("Stage on Changes' row stages only its change", async () => {
		const repo = await splitFile()

		await run('stage', repo.row({ kind: 'changes', file: 'big.ts' }))

		assert.deepEqual(repo.staged('big.ts'), ['three'])
		assert.deepEqual(repo.unstaged('big.ts'), ['twenty'])
	}),
	scenario('Unstage All on a list unstages only its change', async () => {
		const repo = await splitFile()
		repo.git('add', 'big.ts')
		await repo.settle()

		await run('unstageAll', repo.row({ kind: 'changes', changelist: 'Feature' }))

		assert.deepEqual(repo.staged('big.ts'), ['three'])
		assert.deepEqual(repo.unstaged('big.ts'), ['twenty'])
	}),
	scenario("A list's Commit commits only its change", async () => {
		const repo = await splitFile()

		answer({ input: ['Twenty'] })
		await run('commitChangelist', repo.row({ kind: 'changes', changelist: 'Feature' }))

		assert.deepEqual(repo.committedLines(), ['twenty'])
		assert.deepEqual(repo.unstaged('big.ts'), ['three'])
		assert.deepEqual(repo.staged('big.ts'), [])
	}),
	scenario("A list's Commit commits only its change when the whole file is staged", async () => {
		const repo = await splitFile()
		repo.git('add', 'big.ts')
		await repo.settle()

		answer({ warning: ['Unstage & Commit'], input: ['Twenty'] })
		await run('commitChangelist', repo.row({ kind: 'changes', changelist: 'Feature' }))

		assert.deepEqual(repo.committedLines(), ['twenty'])
		assert.deepEqual(repo.unstaged('big.ts'), ['three'])
	}),
	scenario("Discard on a list's row discards only its change", async () => {
		const repo = await splitFile()

		answer({ warning: ['Discard'] })
		await run('discard', repo.row({ kind: 'changes', changelist: 'Feature', file: 'big.ts' }))

		assert.deepEqual(repo.unstaged('big.ts'), ['three'])
	}),
]

/** A repository with big.ts split: line 3's change in Changes, and line 20's in Feature. */
async function splitFile(): Promise<TestRepository> {
	const repo = await repository({ 'big.ts': numbered({}) })

	answer({ input: ['Feature'] })
	await run('newChangelist', repo.row({ kind: 'changes' }))
	repo.write('big.ts', numbered({ 3: 'three', 20: 'twenty' }))
	await repo.settle()

	// Like Move Change to Changelist... in the editor's right-click menu, with the cursor on line 20.
	const editor = await vscode.window.showTextDocument(repo.uri('big.ts'))
	editor.selection = new vscode.Selection(19, 0, 19, 0)
	answer({ pick: ['Feature'] })
	await run('moveChangeToChangelist', repo.uri('big.ts'))
	await repo.settle()

	return repo
}
