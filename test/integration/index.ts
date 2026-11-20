// The integration tests, which VS Code runs in the test window that scripts/integration.ts starts.
import { changelistScenarios } from './changelists.ts'
import { commitScenarios } from './commit.ts'
import { gitignoreScenarios } from './gitignore.ts'
import { runScenarios } from './harness.ts'
import { partialChangelistScenarios } from './partialChangelists.ts'
import { selectionScenarios } from './selection.ts'

/** Called by VS Code once the window is open. Throwing fails the run. */
export async function run(): Promise<void> {
	const scenarios = [
		...changelistScenarios,
		...partialChangelistScenarios,
		...selectionScenarios,
		...commitScenarios,
		...gitignoreScenarios,
	]

	const failed = await runScenarios(scenarios)

	if (failed > 0) {
		throw new Error(`${failed} of ${scenarios.length} integration tests failed`)
	}
}
