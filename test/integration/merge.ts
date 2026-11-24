// Opening a file with merge conflicts from Merge Changes.
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { repository, run, scenario, waitFor } from './harness.ts'
import type { TestRepository } from './harness.ts'

export const mergeScenarios = [
	scenario('A conflict opens in the merge editor when git.mergeEditor is on', async () => {
		const repo = await conflict()
		await setMergeEditor(true)

		try {
			await run('openChange', repo.row({ kind: 'merge', file: 'a.ts' }))
			const result = await waitFor('the merge editor', mergeEditorResult)

			assert.equal(result.fsPath, repo.uri('a.ts').fsPath)
		} finally {
			await setMergeEditor(undefined)
		}
	}),
	scenario('A conflict opens as a file with its conflict markers when git.mergeEditor is off', async () => {
		const repo = await conflict()

		await run('openChange', repo.row({ kind: 'merge', file: 'a.ts' }))
		const editor = await waitFor('the file', () => vscode.window.activeTextEditor)

		assert.equal(editor.document.uri.fsPath, repo.uri('a.ts').fsPath)
		assert.equal(mergeEditorResult(), undefined)
	}),
]

/** A repository in the middle of a merge, where both branches changed a.ts. */
async function conflict(): Promise<TestRepository> {
	const repo = await repository({ 'a.ts': 'a\n' })

	repo.git('checkout', '-q', '-b', 'other')
	repo.write('a.ts', 'theirs\n')
	repo.git('commit', '-q', '-am', 'Theirs')
	repo.git('checkout', '-q', 'main')
	repo.write('a.ts', 'ours\n')
	repo.git('commit', '-q', '-am', 'Ours')
	assert.throws(() => repo.git('merge', '-q', 'other'))
	await repo.settle()

	return repo
}

/** Turns the Git extension's `git.mergeEditor` on or off, or back to its default with undefined. */
function setMergeEditor(value: boolean | undefined): Thenable<void> {
	return vscode.workspace.getConfiguration('git').update('mergeEditor', value, vscode.ConfigurationTarget.Global)
}

/** The file the active tab's merge editor writes to, when it's a merge editor. */
function mergeEditorResult(): vscode.Uri | undefined {
	// Its tab's input, TabInputTextMerge, is newer than the VS Code types the extension is built with.
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { result?: vscode.Uri } | undefined
	return input?.result
}
