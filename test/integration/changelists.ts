// Changelists in a repository: a list's Commit and the repository's Stage All.
import * as assert from 'node:assert/strict'
import { answer, repository, run, scenario } from './harness.ts'
import type { TestRepository } from './harness.ts'

export const changelistScenarios = [
	scenario("A list's Commit commits only its files", async () => {
		const repo = await listWithOneFile()

		answer({ input: ['Add b'] })
		await run('commitChangelist', repo.row({ kind: 'changes', changelist: 'Feature' }))

		assert.deepEqual(repo.committedFiles(), ['b.ts'])
		assert.deepEqual(repo.unstaged('a.ts'), ['a2'])
	}),

	scenario("The repository's Stage All leaves the lists' files unstaged", async () => {
		const repo = await listWithOneFile()

		await run('stageAll', repo.row())

		assert.deepEqual(repo.staged('a.ts'), ['a2'])
		assert.deepEqual(repo.staged('b.ts'), [])
	}),
]

/** A repository with a.ts and b.ts changed, and b.ts is in the list Feature. */
async function listWithOneFile(): Promise<TestRepository> {
	const repo = await repository({ 'a.ts': 'a\n', 'b.ts': 'b\n' })

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
