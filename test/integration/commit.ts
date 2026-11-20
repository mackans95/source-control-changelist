// Commit (Amend) and Commit & Push, on the repository and on a list.
import * as assert from 'node:assert/strict'
import { answer, repository, run, scenario } from './harness.ts'
import type { TestRepository } from './harness.ts'

export const commitScenarios = [
	scenario("A list's Commit (Amend) adds only its files to the last commit", async () => {
		const repo = await listAfterACommit()

		answer({ input: ['Add b and c'] })
		await run('commitChangelistAmend', repo.row({ kind: 'changes', changelist: 'Feature' }))

		assert.equal(repo.commitCount(), 2)
		assert.equal(repo.committedMessage(), 'Add b and c')
		assert.deepEqual(repo.committedFiles(), ['b.ts', 'c.ts'])
		assert.deepEqual(repo.unstaged('a.ts'), ['a2'])
	}),
	scenario("The repository's Commit (Amend) with nothing staged changes only the message's first line", async () => {
		const repo = await listAfterACommit()
		repo.git('commit', '-q', '--amend', '-m', 'Add c', '-m', 'Because.')

		answer({ input: ['Add c, really'] })
		await run('commitAmend', repo.row())

		assert.equal(repo.commitCount(), 2)
		assert.equal(repo.committedMessage(), 'Add c, really\n\nBecause.')
		assert.deepEqual(repo.committedFiles(), ['c.ts'])
	}),
	scenario('Commit (Amend) asks first when the last commit is pushed', async () => {
		const repo = await listAfterACommit()
		await repo.addRemote()

		answer({ warning: ['Cancel'] })
		await run('commitAmend', repo.row())
		assert.equal(repo.committedMessage(), 'Add c')

		answer({ warning: ['Amend'], input: ['Add c, really'] })
		await run('commitAmend', repo.row())
		assert.equal(repo.committedMessage(), 'Add c, really')
	}),
	scenario("A list's Commit & Push commits its files and pushes them", async () => {
		const repo = await listAfterACommit()
		await repo.addRemote()

		answer({ input: ['Add b'] })
		await run('commitChangelistAndPush', repo.row({ kind: 'changes', changelist: 'Feature' }))

		assert.deepEqual(repo.committedFiles(), ['b.ts'])
		assert.ok(repo.pushed())
	}),
	scenario('Commit & Push publishes a branch that has no upstream, after asking', async () => {
		const repo = await listAfterACommit()
		await repo.addRemote(false)

		answer({ warning: ['Stage All & Commit', 'Publish Branch'], input: ['Change a'] })
		await run('commitAndPush', repo.row())

		assert.deepEqual(repo.committedFiles(), ['a.ts'])
		assert.ok(repo.pushed())
	}),
]

/** A repository with a second commit that adds c.ts, then a.ts and b.ts changed, and b.ts in the list Feature. */
async function listAfterACommit(): Promise<TestRepository> {
	const repo = await repository({ 'a.ts': 'a\n', 'b.ts': 'b\n' })

	repo.write('c.ts', 'c\n')
	repo.git('add', 'c.ts')
	repo.git('commit', '-q', '-m', 'Add c')
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
