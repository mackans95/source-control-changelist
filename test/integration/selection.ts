// Commands on several selected rows. The view passes the selected rows after the row the command was
// run on, like these tests do.
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { answer, numbered, repository, run, scenario } from './harness.ts'
import type { TestRepository } from './harness.ts'

export const selectionScenarios = [
	scenario('Stage on selected files in different lists stages them all', async () => {
		const repo = await twoLists()
		const a = repo.row({ kind: 'changes', file: 'a.ts' })
		const b = repo.row({ kind: 'changes', changelist: 'Feature', file: 'b.ts' })

		await run('stage', b, [a, b])

		assert.deepEqual(repo.staged('a.ts'), ['a2'])
		assert.deepEqual(repo.staged('b.ts'), ['b2'])
	}),
	scenario("Stage on a list's selected files stages only the list's part of a split file", async () => {
		const repo = await repository({ 'a.ts': 'a\n', 'big.ts': numbered({}) })
		answer({ input: ['Feature'] })
		await run('newChangelist', repo.row({ kind: 'changes' }))
		repo.write('a.ts', 'a2\n')
		repo.write('big.ts', numbered({ 3: 'three', 20: 'twenty' }))
		await repo.settle()
		answer({ pick: ['Feature'] })
		await run('moveToChangelist', repo.row({ kind: 'changes', file: 'a.ts' }))
		// Line 3's change goes to Feature from the editor, and line 20's stays in Changes.
		const editor = await vscode.window.showTextDocument(repo.uri('big.ts'))
		editor.selection = new vscode.Selection(2, 0, 2, 0)
		answer({ pick: ['Feature'] })
		await run('moveChangeToChangelist', repo.uri('big.ts'))
		await repo.settle()
		const a = repo.row({ kind: 'changes', changelist: 'Feature', file: 'a.ts' })
		const big = repo.row({ kind: 'changes', changelist: 'Feature', file: 'big.ts' })

		await run('stage', a, [a, big])

		assert.deepEqual(repo.staged('a.ts'), ['a2'])
		assert.deepEqual(repo.staged('big.ts'), ['three'])
		assert.deepEqual(repo.unstaged('big.ts'), ['twenty'])
	}),
	scenario('Move to Changelist on selected files from Changes and a list moves them together', async () => {
		const repo = await twoLists()
		answer({ input: ['Bugfix'] })
		await run('newChangelist', repo.row({ kind: 'changes' }))
		const a = repo.row({ kind: 'changes', file: 'a.ts' })
		const b = repo.row({ kind: 'changes', changelist: 'Feature', file: 'b.ts' })

		answer({ pick: ['Bugfix'] })
		await run('moveToChangelist', a, [a, b])
		await repo.settle()
		answer({ input: ['Fix'] })
		await run('commitChangelist', repo.row({ kind: 'changes', changelist: 'Bugfix' }))

		assert.deepEqual(repo.committedFiles(), ['a.ts', 'b.ts'])
	}),
	scenario('Discard on selected files asks once, and discards and deletes them all', async () => {
		const repo = await twoLists()
		repo.write('new.ts', 'new\n')
		await repo.settle()
		const a = repo.row({ kind: 'changes', file: 'a.ts' })
		const b = repo.row({ kind: 'changes', changelist: 'Feature', file: 'b.ts' })
		// Git's default `git.untrackedChanges` shows new files in Changes.
		const untracked = repo.row({ kind: 'changes', file: 'new.ts' })

		answer({ warning: ['Discard'] })
		await run('discard', a, [a, b, untracked])

		assert.equal(repo.git('status', '--porcelain'), '')
	}),
	scenario('Dropping selected files on a list moves them all there', async () => {
		const repo = await twoLists()
		repo.write('c.ts', 'c2\n')
		await repo.settle()
		const a = repo.row({ kind: 'changes', file: 'a.ts' })
		const c = repo.row({ kind: 'changes', file: 'c.ts' })

		await run('dropChanges', repo.row({ kind: 'changes', changelist: 'Feature' }), [a, c])
		await repo.settle()
		answer({ input: ['Feature'] })
		await run('commitChangelist', repo.row({ kind: 'changes', changelist: 'Feature' }))

		assert.deepEqual(repo.committedFiles(), ['a.ts', 'b.ts', 'c.ts'])
	}),
]

/** A repository with a.ts in Changes and b.ts in Feature, both changed, and c.ts unchanged. */
async function twoLists(): Promise<TestRepository> {
	const repo = await repository({ 'a.ts': 'a\n', 'b.ts': 'b\n', 'c.ts': 'c\n' })

	answer({ input: ['Feature'] })
	await run('newChangelist', repo.row({ kind: 'changes' }))
	repo.write('a.ts', 'a2\n')
	repo.write('b.ts', 'b2\n')
	await repo.settle()

	answer({ pick: ['Feature'] })
	await run('moveToChangelist', repo.row({ kind: 'changes', file: 'b.ts' }))
	await repo.settle()

	return repo
}
