// What the Repositories panel runs on its repositories: Fetch All, Pull All and Checkout Default on
// many at once, and a row's Push, Pull, Sync, Publish Branch and Fetch on one. Each repository's
// status shows at the end of its row, and the view's progress bar shows while anything runs. While
// Fetch All, Pull All or Checkout Default runs, its title bar button is disabled.
import * as vscode from 'vscode'
import { gitErrorMessage, repositoryName } from './changelistModel.ts'
import type { Repository } from './types/git.ts'
import type { OperationKind, OperationLabels } from './types/extension.ts'
import type { OperationStatus } from './types/shared.ts'

// Where the progress bar shows while an operation, or a row's sync button, runs.
export const VIEW_PROGRESS: vscode.ProgressOptions = { location: { viewId: 'changelist.view' } }
// How long a repository's ✓ stays before it fades.
const DONE_FADE_MS = 3000
// What each operation is called while it runs, when it's done, and when it fails.
const OPERATION_LABELS: Record<OperationKind, OperationLabels> = {
	fetch: {
		name: 'Fetch All',
		running: 'Fetching...',
		done: 'Fetched',
		verb: 'fetch',
	},
	pull: {
		name: 'Pull All',
		running: 'Pulling...',
		done: 'Pulled',
		verb: 'pull',
	},
	push: {
		name: 'Push',
		running: 'Pushing...',
		done: 'Pushed',
		verb: 'push',
	},
	sync: {
		name: 'Sync',
		running: 'Syncing...',
		done: 'Synced',
		verb: 'sync',
	},
	publish: {
		name: 'Publish Branch',
		running: 'Publishing...',
		done: 'Published',
		verb: 'publish',
	},
	checkout: {
		name: 'Checkout Default',
		running: 'Switching to the default branch...',
		done: 'Switched to the default branch',
		verb: 'switch',
	},
}

/**
 * Runs Fetch All, Pull All and Checkout Default one at a time, and a row's own buttons, and keeps
 * each repository's status.
 */
export class Operations implements vscode.Disposable {
	// Fires when a repository's status changes, so the view is drawn again.
	private readonly changeEmitter = new vscode.EventEmitter<void>()
	// Each repository's status, by its root URI.
	private readonly statuses = new Map<string, OperationStatus>()
	// The timers that fade the ✓s, which a new run cancels.
	private readonly fadeTimers = new Set<NodeJS.Timeout>()

	// The operation that's running, if any.
	private running: OperationKind | undefined

	// When a repository's status changes.
	readonly onDidChange = this.changeEmitter.event

	/** What the last operation did with a repository, if anything. */
	get(repository: Repository): OperationStatus | undefined {
		return this.statuses.get(repository.rootUri.toString())
	}

	/**
	 * Runs an operation on every repository in `repositories` at once, after clearing the statuses of
	 * the last one. `skipped` repositories get their reason as their status instead.
	 */
	async run(
		kind: OperationKind,
		repositories: readonly Repository[],
		operation: (repository: Repository) => Promise<unknown>,
		skipped: readonly (readonly [Repository, string])[] = [],
	): Promise<void> {
		// From the Command Palette, while its disabled button shows that one runs already.
		if (this.running) {
			void vscode.window.showInformationMessage(`${OPERATION_LABELS[this.running].name} is still running.`)
			return
		}

		const labels = OPERATION_LABELS[kind]
		this.clear()
		this.setRunning(kind)
		skipped.forEach(([repository, reason]) => this.setStatus(repository, { state: 'skipped', message: reason }))
		repositories.forEach(repository => this.setStatus(repository, { state: 'running', message: labels.running }))
		this.changeEmitter.fire()

		try {
			const succeeded = await vscode.window.withProgress(VIEW_PROGRESS, () =>
				Promise.all(repositories.map(repository => this.attempt(repository, operation, labels))),
			)
			this.reportFailures(
				labels,
				repositories.filter((_, i) => !succeeded[i]),
			)
		} finally {
			this.setRunning(undefined)
		}
	}

	/**
	 * Runs an operation on one repository, from its row's button or right-click menu. The other
	 * repositories keep their statuses.
	 */
	async runSingle(
		kind: OperationKind,
		repository: Repository,
		operation: (repository: Repository) => Promise<unknown>,
	): Promise<void> {
		const labels = OPERATION_LABELS[kind]

		if (this.get(repository)?.state === 'running') return

		this.setStatus(repository, { state: 'running', message: labels.running })
		this.changeEmitter.fire()

		const succeeded = await vscode.window.withProgress(VIEW_PROGRESS, () =>
			this.attempt(repository, operation, labels),
		)
		this.reportFailures(labels, succeeded ? [] : [repository])
	}

	/** Stops the change event and the fade timers. */
	dispose(): void {
		this.fadeTimers.forEach(timer => clearTimeout(timer))
		this.changeEmitter.dispose()
	}

	/** Runs the operation on one repository, and returns whether it worked. */
	private async attempt(
		repository: Repository,
		operation: (repository: Repository) => Promise<unknown>,
		labels: OperationLabels,
	): Promise<boolean> {
		try {
			await operation(repository)
			const status: OperationStatus = { state: 'done', message: labels.done }
			this.setStatus(repository, status)
			this.fadeLater(repository, status)
			return true
		} catch (error) {
			this.setStatus(repository, { state: 'failed', message: gitErrorMessage(error) })
			return false
		} finally {
			this.changeEmitter.fire()
		}
	}

	/** Says which repositories failed, if any. Their row has the reason. */
	private reportFailures(labels: OperationLabels, failed: readonly Repository[]): void {
		if (failed.length > 0) {
			void vscode.window.showWarningMessage(
				`Couldn't ${labels.verb} ${failed.map(repositoryName).join(', ')}. Hover over the ✗ in the Repositories panel to see why.`,
			)
		}
	}

	/** Takes a ✓ away after DONE_FADE_MS, unless a new run has replaced it. */
	private fadeLater(repository: Repository, status: OperationStatus): void {
		const timer = setTimeout(() => {
			this.fadeTimers.delete(timer)

			if (this.get(repository) === status) {
				this.statuses.delete(repository.rootUri.toString())
				this.changeEmitter.fire()
			}
		}, DONE_FADE_MS)
		this.fadeTimers.add(timer)
	}

	/** Sets a repository's status, without drawing the view again. */
	private setStatus(repository: Repository, status: OperationStatus): void {
		this.statuses.set(repository.rootUri.toString(), status)
	}

	/** Forgets every status, before a new run. */
	private clear(): void {
		this.fadeTimers.forEach(timer => clearTimeout(timer))
		this.fadeTimers.clear()
		this.statuses.clear()
	}

	/** Notes the running operation, and sets `changelist.operation`, which disables its button. */
	private setRunning(kind: OperationKind | undefined): void {
		this.running = kind
		void vscode.commands.executeCommand('setContext', 'changelist.operation', kind)
	}
}
