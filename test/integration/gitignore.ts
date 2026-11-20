// Add to .gitignore on untracked files and folders.
import * as assert from 'node:assert/strict'
import { repository, run, scenario } from './harness.ts'

export const gitignoreScenarios = [
	scenario('Add to .gitignore makes a .gitignore with the selected untracked files and folders', async () => {
		const repo = await repository({ 'a.ts': 'a\n' })
		repo.write('a.ts', 'a2\n')
		repo.write('new.ts', 'new\n')
		repo.write('gen/one.js', '1\n')
		repo.write('gen/two.js', '2\n')
		await repo.settle()
		// Git's default `git.untrackedChanges` shows new files in Changes.
		const rows = [
			repo.row({ kind: 'changes', file: 'new.ts' }),
			repo.row({ kind: 'changes', folder: 'gen' }),
			repo.row({ kind: 'changes', file: 'a.ts' }),
		]

		await run('addToGitignore', rows[0], rows)
		await repo.settle()

		// a.ts is tracked, so it's left out.
		assert.equal(repo.read('.gitignore'), '/new.ts\n/gen/\n')
		assert.equal(repo.git('status', '--porcelain'), 'M a.ts\n?? .gitignore')
	}),
	scenario('Add to .gitignore adds a line to the end of the .gitignore there is', async () => {
		const repo = await repository({ '.gitignore': 'node_modules' })
		repo.write('debug.log', 'log\n')
		await repo.settle()

		await run('addToGitignore', repo.row({ kind: 'changes', file: 'debug.log' }))

		assert.equal(repo.read('.gitignore'), 'node_modules\n/debug.log\n')
	}),
]
