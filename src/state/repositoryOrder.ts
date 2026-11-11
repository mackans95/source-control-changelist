// The order the user dragged the repositories into, saved in the workspace's state on this machine.
import * as vscode from 'vscode'

// The workspace state's key, with the repositories' root URIs in their order.
const STATE_KEY = 'repositoryOrder'

/** The repositories' order, saved in the workspace's state. */
export class RepositoryOrder implements vscode.Disposable {
	// The workspace's state.
	private readonly state: vscode.Memento
	private readonly changeEmitter = new vscode.EventEmitter<void>()

	// When the order changes.
	readonly onDidChange = this.changeEmitter.event

	constructor(state: vscode.Memento) {
		this.state = state
		this.updateContext()
	}

	/** The repositories' root URIs in the user's order, or none when they haven't dragged any. */
	get(): readonly string[] {
		return this.state.get<string[]>(STATE_KEY, [])
	}

	/** Saves a new order, and draws the view again. */
	async set(order: readonly string[]): Promise<void> {
		await this.state.update(STATE_KEY, order.length > 0 ? order : undefined)
		this.updateContext()
		this.changeEmitter.fire()
	}

	/** Forgets the order, so the repositories are in the order of the workspace's folders again. */
	reset(): Promise<void> {
		return this.set([])
	}

	/** Stops the change event. */
	dispose(): void {
		this.changeEmitter.dispose()
	}

	/** Shows Reset Repository Order in the panel's menu while there's an order to reset. */
	private updateContext(): void {
		void vscode.commands.executeCommand('setContext', 'changelist.repositoriesOrdered', this.get().length > 0)
	}
}
