// The Changelist view: keeps the webview's rows up to date, and runs what its rows ask for.
import * as vscode from 'vscode'
import { viewHtml } from './html.ts'
import { resolveTarget } from './targets.ts'
import { buildUpdate } from './update.ts'
import { canDropChanges } from '../helpers/shared.ts'
import { FileIcons } from '../icons/fileIcons.ts'
import { mainRepository, moveInOrder, sortRepositories } from '../model/repositories.ts'
import { needsSync } from '../model/sync.ts'
import type { Node, Services } from '../types/extension.ts'
import type { Repository } from '../types/git.ts'
import type { ActionTarget, ExtensionMessage, WebviewAction, WebviewMessage } from '../types/shared.ts'

// Git reports a change for each step of a checkout or a commit, so the view waits until it's quiet.
const UPDATE_DELAY_MS = 100

// The settings that change what the view shows.
const VIEW_SETTINGS = ['changelist.viewMode', 'git.autofetch', 'scm.alwaysShowActions', 'workbench.hover.delay']

/** The Changelist view's provider: the repositories that have changes, grouped like the Source Control view. */
export class ChangelistWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private readonly services: Services
	// The extension's folder, with the page's script and stylesheet in its dist/.
	private readonly extensionUri: vscode.Uri
	private readonly fileIcons = new FileIcons()

	// The view, from when VS Code resolves it until it closes.
	private view: vscode.WebviewView | undefined
	// The page loads again each time the view is shown, and says when it's ready for data.
	private ready = false
	private showingRepositories = false
	// The last update sent, as JSON, so the same one isn't sent again.
	private lastUpdate: string | undefined
	private lastNeedsSync = false
	private updateTimer: NodeJS.Timeout | undefined

	// For as long as the provider lives.
	private readonly disposables: vscode.Disposable[] = []
	// By root URI, since `git.repositories` makes new objects on every call.
	private readonly repositoryListeners = new Map<string, vscode.Disposable>()
	// For the current view, replaced when VS Code resolves it again.
	private viewDisposables: vscode.Disposable[] = []

	constructor(services: Services, extensionUri: vscode.Uri) {
		this.services = services
		this.extensionUri = extensionUri
		this.listen()
	}

	/** Called by VS Code to show the view: loads the page, which then asks for the data. */
	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.viewDisposables.forEach(d => d.dispose())
		this.view = webviewView
		this.ready = false
		this.updateDescription()

		webviewView.webview.options = this.webviewOptions()
		webviewView.webview.html = viewHtml(webviewView.webview, this.extensionUri)

		this.viewDisposables = [
			webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => this.onDidReceiveMessage(message)),
			webviewView.onDidChangeVisibility(() => {
				if (!webviewView.visible) {
					this.ready = false
				}
			}),
			webviewView.onDidDispose(() => {
				if (this.view === webviewView) {
					this.view = undefined
					this.ready = false
				}
			}),
		]
	}

	/** Has Git check every repository again, and in the Repositories panel looks up the default branches. */
	async refresh(): Promise<void> {
		const { git, defaultBranches } = this.services
		await Promise.all(git.repositories.map(r => r.status()))

		if (this.showingRepositories) {
			await defaultBranches.refresh(git.repositories)
		}

		this.postUpdate()
	}

	/** Expands or collapses every row. */
	setAllExpanded(expanded: boolean): void {
		this.postMessage({ type: 'setAllExpanded', expanded })
	}

	/** Shows the Repositories panel instead of the changes, or the changes again. */
	showRepositories(show: boolean): void {
		this.showingRepositories = show
		void setContext('changelist.showingRepositories', show)
		this.updateDescription()

		if (show) {
			// From the Command Palette, the view may be hidden.
			void vscode.commands.executeCommand('changelist.view.focus')
			void this.services.defaultBranches.refresh(this.services.git.repositories)
		}

		this.postUpdate()
	}

	/** Stops listening to the repositories, the settings and the view. */
	dispose(): void {
		clearTimeout(this.updateTimer)
		this.repositoryListeners.forEach(d => d.dispose())
		this.viewDisposables.forEach(d => d.dispose())
		this.disposables.forEach(d => d.dispose())
	}

	/** Listens to the repositories, the services and the settings that change what the view shows. */
	private listen(): void {
		const { git, changelists, operations, defaultBranches, repositoryOrder } = this.services

		for (const repository of git.repositories) {
			this.onDidOpenRepository(repository)
		}

		this.disposables.push(
			this.fileIcons,
			this.fileIcons.onDidChange(() => this.onDidChangeFileIcons()),
			git.onDidOpenRepository(r => this.onDidOpenRepository(r)),
			git.onDidCloseRepository(r => this.onDidCloseRepository(r)),
			changelists.onDidChange(() => this.postUpdate()),
			operations.onDidChange(() => this.postUpdate()),
			defaultBranches.onDidChange(() => this.postUpdate()),
			repositoryOrder.onDidChange(() => this.postUpdate()),
			// The repositories are sorted like the workspace's folders.
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.postUpdate()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (VIEW_SETTINGS.some(setting => e.affectsConfiguration(setting))) {
					this.postUpdate()
				}
				// Turning it off puts every split file back together, in its own list.
				if (e.affectsConfiguration('changelist.partialChangelists')) {
					git.repositories.forEach(r => void this.services.hunks.track(r))
				}
			}),
		)
	}

	/** Listens to a repository Git opened, which keeps its changelists up to date. */
	private onDidOpenRepository(repository: Repository): void {
		// Now for a repository Git has checked already, and after each check from then on.
		this.track(repository)
		this.repositoryListeners.set(
			repository.rootUri.toString(),
			repository.state.onDidChange(() => {
				this.track(repository)
				this.scheduleUpdate()
			}),
		)
		this.scheduleUpdate()
	}

	/** Puts a repository's new changes in the active list, first its files and then their changes. */
	private track(repository: Repository): void {
		this.services.changelists.track(repository)
		void this.services.hunks.track(repository)
	}

	/** Stops listening to a repository Git closed. */
	private onDidCloseRepository(repository: Repository): void {
		this.repositoryListeners.get(repository.rootUri.toString())?.dispose()
		this.repositoryListeners.delete(repository.rootUri.toString())
		this.scheduleUpdate()
	}

	/** Sends the rows again with the new file icon theme's icons. */
	private onDidChangeFileIcons(): void {
		// The new theme's icons can be in another extension's folder, which reloads the page.
		if (this.view) {
			this.view.webview.options = this.webviewOptions()
		}

		this.postUpdate()
	}

	/** Lets the page load the view's own files, and the file icon theme's icons and fonts. */
	private webviewOptions(): vscode.WebviewOptions {
		const iconRoot = this.fileIcons.resourceRoot

		return {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), ...(iconRoot ? [iconRoot] : [])],
		}
	}

	/** Updates the view once Git has been quiet for UPDATE_DELAY_MS. */
	private scheduleUpdate(): void {
		clearTimeout(this.updateTimer)
		this.updateTimer = setTimeout(() => {
			this.updateNeedsSync()
			this.updateDescription()
			this.postUpdate()
		}, UPDATE_DELAY_MS)
	}

	/** Sets `changelist.needsSync`, which puts a dot on the Repositories button. */
	private updateNeedsSync(): void {
		const value = this.services.git.repositories.some(needsSync)

		if (value !== this.lastNeedsSync) {
			this.lastNeedsSync = value
			void setContext('changelist.needsSync', value)
		}
	}

	/** Says next to the view's title when it shows the Repositories panel, and how many need a sync. */
	private updateDescription(): void {
		if (!this.view) return

		const count = this.services.git.repositories.filter(needsSync).length
		const description = count > 0 ? `Repositories · ${count} to sync` : 'Repositories'
		this.view.description = this.showingRepositories ? description : undefined
	}

	/** Sends the page its rows, unless they're what it shows already. */
	private postUpdate(): void {
		if (!this.view || !this.ready) return

		const icons = this.fileIcons.resolver(this.view.webview)
		const message = buildUpdate(this.services, this.sortedRepositories(), icons, this.showingRepositories)
		// Git reports a change after every check, also when nothing changed, and drawing the rows again
		// would end the hover under the mouse.
		const json = JSON.stringify(message)

		if (json === this.lastUpdate) return

		this.lastUpdate = json
		this.postMessage(message)
	}

	/** Every open repository, in the user's order, or else in the workspace's folder order. */
	private sortedRepositories(): Repository[] {
		const folders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? []
		return sortRepositories(this.services.git.repositories, folders, this.services.repositoryOrder.get())
	}

	/** Sends the page a message, once it's ready for one. */
	private postMessage(message: ExtensionMessage): void {
		if (this.view && this.ready) {
			void this.view.webview.postMessage(message)
		}
	}

	/** Handles a message from the page. */
	private async onDidReceiveMessage(message: WebviewMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
				return this.onPageReady()
			case 'allCollapsed':
				return setContext('changelist.allCollapsed', message.value)
			case 'closeRepositories':
				return this.showRepositories(false)
			case 'turnOnAutoFetch':
				return turnOnAutoFetch()
			case 'moveRepository':
				return this.moveRepository(message.repository, message.target, message.after)
			case 'dropChanges':
				return this.dropChanges(message.source, message.target)
			case 'run':
				return this.runAction(message.action, message.target)
		}
	}

	/** Sends a new page, which has nothing yet, its rows. */
	private onPageReady(): void {
		this.ready = true
		this.lastUpdate = undefined
		this.postUpdate()
	}

	/** Moves a repository right before or after another, and saves the order of the main repositories. */
	private async moveRepository(repository: string, target: string, after: boolean): Promise<void> {
		// Worktrees follow their repository, so they aren't in the order.
		const all = this.sortedRepositories()
		const current = all.filter(r => !mainRepository(r, all)).map(r => r.rootUri.toString())
		const order = moveInOrder(current, repository, target, after)

		if (order.some((uri, i) => uri !== current[i])) {
			await this.services.repositoryOrder.set(order)
		}
	}

	/** Drops a file's or folder's changes on another group, if they can go there. */
	private async dropChanges(source: ActionTarget, target: ActionTarget): Promise<void> {
		const sourceNode = resolveTarget(this.services, source)
		const targetNode = resolveTarget(this.services, target)

		// The page only allows these drops too, but its rows can be out of date.
		if (sourceNode && targetNode && canDropChanges(source, target)) {
			await this.runCommand('dropChanges', sourceNode, targetNode)
		}
	}

	/** Runs a row's action on the row. */
	private async runAction(action: WebviewAction, target: ActionTarget): Promise<void> {
		const node = resolveTarget(this.services, target)

		if (node) {
			await this.runCommand(action, node)
		}
	}

	/** Runs a `changelist.*` command, and shows its error if it fails. */
	private async runCommand(command: string, ...nodes: Node[]): Promise<void> {
		try {
			await vscode.commands.executeCommand(`changelist.${command}`, ...nodes)
		} catch (error) {
			// Commands run from the webview don't get VS Code's own error notification.
			void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
		}
	}
}

/** Sets a context key for the `when` clauses in package.json. */
async function setContext(key: string, value: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', key, value)
}

/** Turns on the Git extension's `git.autofetch`, for the Repositories panel's notice. */
async function turnOnAutoFetch(): Promise<void> {
	await vscode.workspace.getConfiguration('git').update('autofetch', true, vscode.ConfigurationTarget.Global)
}
