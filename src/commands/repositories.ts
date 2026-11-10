// What runs on whole repositories: switching branch, push, pull, sync, publish and fetch, the
// Repositories panel's Fetch All, Pull All and Checkout Default, and opening a repository's folder.
import * as vscode from 'vscode'
import { forNodes } from './nodes.ts'
import { hasChanges } from '../model/changes.ts'
import { repositoryName } from '../model/repositories.ts'
import { needsPull } from '../model/sync.ts'
import { VIEW_PROGRESS } from '../state/operations.ts'
import type { DefaultBranches } from '../state/defaultBranches.ts'
import type { Operations } from '../state/operations.ts'
import type { CheckoutPlan, CommandTable, RepositoryNode, Services } from '../types/extension.ts'
import type { API, Repository } from '../types/git.ts'

/** The commands on repositories' rows, and the Repositories panel's title bar. */
export function repositoryCommands({ git, operations, defaultBranches, repositoryOrder }: Services): CommandTable {
	return {
		checkout: forNodes(['repository'], node => runGitCommand('git.checkout', node)),
		push: forNodes(['repository'], node => operations.runSingle('push', node.repository, r => r.push())),
		pull: forNodes(['repository'], node => operations.runSingle('pull', node.repository, r => r.pull())),
		sync: forNodes(['repository'], node =>
			operations.runSingle('sync', node.repository, async r => {
				await r.pull()
				await r.push()
			}),
		),
		publish: forNodes(['repository'], node => publish(node, operations)),
		fetch: forNodes(['repository'], node => operations.runSingle('fetch', node.repository, r => r.fetch())),
		fetchAll: () => fetchAll(git, operations),
		pullAll: () => pullAll(git, operations),
		checkoutDefault: () => checkoutDefault(git, operations, defaultBranches),
		resetRepositoryOrder: () => repositoryOrder.reset(),
		openInNewWindow: forNodes(['repository'], node =>
			vscode.commands.executeCommand('vscode.openFolder', node.repository.rootUri, { forceNewWindow: true }),
		),
		// One command with two names: Reveal in Finder on macOS, and Reveal in File Explorer elsewhere.
		revealInFinder: forNodes(['repository'], revealInOS),
		revealInFileExplorer: forNodes(['repository'], revealInOS),
		copyPath: forNodes(['repository'], node => vscode.env.clipboard.writeText(node.repository.rootUri.fsPath)),
	}
}

/** Runs a Git extension command on the repository, which then skips its repository picker. */
function runGitCommand(command: string, node: RepositoryNode): Thenable<unknown> {
	return vscode.commands.executeCommand(command, node.repository)
}

/** Publishes the branch to the repository's only remote, or else lets the Git extension ask where to. */
function publish(node: RepositoryNode, operations: Operations): Thenable<unknown> {
	const { remotes, HEAD } = node.repository.state

	if (remotes.length === 1 && HEAD?.name) {
		const branch = HEAD.name
		return operations.runSingle('publish', node.repository, r => r.push(remotes[0].name, branch, true))
	}

	// The Git extension's Publish Branch only shows the progress bar, not a status on the row.
	return vscode.window.withProgress(VIEW_PROGRESS, () => runGitCommand('git.publish', node))
}

/** Fetches every repository that has a remote, so the Repositories panel knows what there is to pull. */
function fetchAll(git: API, operations: Operations): Promise<void> {
	const repositories = git.repositories.filter(r => r.state.remotes.length > 0)
	return operations.run('fetch', repositories, r => r.fetch())
}

/** Pulls every repository that has commits to pull. */
async function pullAll(git: API, operations: Operations): Promise<void> {
	// Diverged ones can fail, depending on how they reconcile, and their row says why.
	const repositories = git.repositories.filter(needsPull)

	if (repositories.length === 0) {
		void vscode.window.showInformationMessage('No repository has commits to pull.')
		return
	}

	await operations.run('pull', repositories, r => r.pull())
}

/** Switches every repository that can to its default branch, after asking. */
async function checkoutDefault(git: API, operations: Operations, defaultBranches: DefaultBranches): Promise<void> {
	await defaultBranches.refresh(git.repositories)

	const { targets, skipped } = checkoutPlan(git.repositories, defaultBranches)

	if (targets.size === 0) {
		void vscode.window.showInformationMessage('Every repository that can switch is on its default branch.')
	} else if (!(await confirmCheckout(targets))) {
		return
	}

	// The skipped ones show why on their row.
	await operations.run('checkout', [...targets.keys()], r => r.checkout(targets.get(r) ?? ''), skipped)
}

/** The repositories Checkout Default switches, with their branch, and the ones it skips, with why. */
function checkoutPlan(repositories: readonly Repository[], defaultBranches: DefaultBranches): CheckoutPlan {
	const targets = new Map<Repository, string>()
	const skipped: [Repository, string][] = []

	for (const repository of repositories) {
		const branch = defaultBranches.get(repository)

		// One that's on its default branch already is left out.
		if (branch !== undefined && repository.state.HEAD?.name === branch) continue

		const reason = checkoutSkipReason(repository, branch)

		if (reason !== undefined) {
			skipped.push([repository, reason])
		} else if (branch !== undefined) {
			targets.set(repository, branch)
		}
	}

	return { targets, skipped }
}

/** Why Checkout Default leaves a repository alone, or undefined when it switches it. */
function checkoutSkipReason(repository: Repository, branch: string | undefined): string | undefined {
	switch (true) {
		case branch === undefined:
			return 'Skipped: no default branch found'
		case repository.kind === 'worktree':
			return "Skipped: it's a worktree"
		case hasChanges(repository):
			return 'Skipped: it has uncommitted changes'
		default:
			return undefined
	}
}

/** Asks whether to switch these repositories, listing each one's branch. */
async function confirmCheckout(targets: ReadonlyMap<Repository, string>): Promise<boolean> {
	const count = targets.size === 1 ? '1 repository' : `${targets.size} repositories`
	const detail = [...targets].map(([r, branch]) => `${repositoryName(r)}: ${branch}`).join('\n')
	const choice = await vscode.window.showWarningMessage(
		`Switch ${count} to the default branch?`,
		{ modal: true, detail },
		'Switch',
	)

	return choice === 'Switch'
}

/** Reveals the repository's folder in Finder, or in the file manager on Windows and Linux. */
function revealInOS(node: RepositoryNode): Thenable<unknown> {
	return vscode.commands.executeCommand('revealFileInOS', node.repository.rootUri)
}
