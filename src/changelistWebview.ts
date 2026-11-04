// Keeps the Changelist view up to date: it listens to every repository and the settings the view
// depends on, and sends the webview its data once the page says it's ready. Messages from the page
// run the `changelist.*` commands on the row they came from. The Repositories button in the title
// bar swaps the changes for every repository's sync status, and gets a dot from
// `changelist.needsSync` when a repository has commits to push or pull.
import * as path from 'path'
import * as vscode from 'vscode'
import { viewHtml } from './changelistHtml.ts'
import { toRepositoryItem, toSyncRepositoryItem } from './changelistItems.ts'
import { byName, getChanges, hasChanges, needsSync } from './changelistModel.ts'
import { DEFAULT_HOVER_DELAY_MS } from './constants/shared.ts'
import { FileIcons } from './fileIcons.ts'
import type { API, Repository } from './types/git.ts'
import type { Node, ViewMode } from './types/extension.ts'
import type { ActionTarget, ExtensionMessage, WebviewMessage } from './types/shared.ts'

// Git reports a change for each step of an operation like a checkout or a commit. The view waits
// this long after the last one, so it's drawn again once and not for every step.
const UPDATE_DELAY_MS = 100

/** The `changelist.viewMode` setting: a flat list of files, or files in folders. */
function getViewMode(): ViewMode {
	return vscode.workspace.getConfiguration('changelist').get<ViewMode>('viewMode', 'list')
}

/**
 * The Changelist view: repositories that have changes, grouped like the built-in Source Control
 * view. It's a webview rather than a tree view so it can have text buttons, bold names and
 * colored counts. Clean repositories are left out, so the view is empty when nothing has changed.
 */
export class ChangelistWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	// Listeners for as long as the provider lives.
	private readonly disposables: vscode.Disposable[] = []
	// Keyed by root URI: `git.repositories` returns new wrapper objects on every call.
	private readonly repositoryListeners = new Map<string, vscode.Disposable>()
	// The file icon theme's icons, which the rows show.
	private readonly fileIcons = new FileIcons()
	// The Git extension's API.
	private readonly git: API
	// The extension's folder. The page's script and stylesheet are in its dist/.
	private readonly extensionUri: vscode.Uri

	// What the webview shows now, as JSON, so it isn't sent the same update again.
	private lastUpdate: string | undefined
	// What `changelist.needsSync` was set to last, so it's only set again when that changes.
	private lastNeedsSync = false
	// Whether the view shows the Repositories panel instead of the changes.
	private showingRepositories = false
	// The wait before the next update, see UPDATE_DELAY_MS.
	private refreshTimer: NodeJS.Timeout | undefined
	// Listeners for the current view, replaced when VS Code resolves the view again.
	private viewDisposables: vscode.Disposable[] = []
	// The webview's page loads again each time the view is shown, and says when it's ready for data.
	private ready = false
	// The view, from when VS Code resolves it until it closes.
	private view: vscode.WebviewView | undefined

	constructor(git: API, extensionUri: vscode.Uri) {
		this.git = git
		this.extensionUri = extensionUri

		for (const repository of git.repositories) {
			this.onDidOpenRepository(repository)
		}

		this.disposables.push(
			this.fileIcons,
			this.fileIcons.onDidChange(() => this.onDidChangeFileIcons()),
			git.onDidOpenRepository(r => this.onDidOpenRepository(r)),
			git.onDidCloseRepository(r => this.onDidCloseRepository(r)),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (
					e.affectsConfiguration('changelist.viewMode') ||
					e.affectsConfiguration('scm.alwaysShowActions') ||
					e.affectsConfiguration('workbench.hover.delay')
				) {
					this.postUpdate()
				}
			}),
		)
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

	/** The view's Refresh button: has Git check every repository's status again, then updates the view. */
	async refresh(): Promise<void> {
		await Promise.all(this.git.repositories.map(r => r.status()))
		this.postUpdate()
	}

	/** The view's Expand All and Collapse All buttons. */
	setAllExpanded(expanded: boolean): void {
		this.postMessage({ type: 'setAllExpanded', expanded })
	}

	/**
	 * The Repositories button and the Back button in the view's title bar: shows every repository's
	 * sync status instead of the changes, or the changes again.
	 */
	showRepositories(show: boolean): void {
		this.showingRepositories = show
		void vscode.commands.executeCommand('setContext', 'changelist.showingRepositories', show)
		this.updateDescription()

		if (show) {
			// From the Command Palette, the view may be hidden.
			void vscode.commands.executeCommand('changelist.view.focus')
		}

		this.postUpdate()
	}

	/**
	 * Turns a target from the webview, or a row's right-click menu context, back into the node the
	 * `changelist.*` commands take.
	 */
	resolveTarget(target: ActionTarget): Node | undefined {
		const repository = this.git.repositories.find(r => r.rootUri.toString() === target.repository)
		if (!repository) {
			return undefined
		}
		if (!target.kind) {
			return { type: 'repository', repository }
		}

		const kind = target.kind
		const changes = getChanges(repository, kind)
		if (!target.uri) {
			return { type: 'group', repository, kind, changes }
		}

		const change = changes.find(c => c.uri.toString() === target.uri)
		if (change) {
			return { type: 'resource', repository, kind, change }
		}

		// Not a file, so a folder: the commands only need the changes below it.
		const uri = vscode.Uri.parse(target.uri)
		const prefix = uri.fsPath + path.sep
		return {
			type: 'folder',
			repository,
			kind,
			uri,
			label: path.basename(uri.fsPath),
			changes: changes.filter(c => c.uri.fsPath.startsWith(prefix)),
			children: [],
		}
	}

	/** Stops listening to the repositories, the settings and the view. */
	dispose(): void {
		clearTimeout(this.refreshTimer)
		this.repositoryListeners.forEach(d => d.dispose())
		this.viewDisposables.forEach(d => d.dispose())
		this.disposables.forEach(d => d.dispose())
	}

	/** Listens to a repository Git opened, and shows it when it has changes. */
	private onDidOpenRepository(repository: Repository): void {
		this.repositoryListeners.set(
			repository.rootUri.toString(),
			repository.state.onDidChange(() => this.scheduleUpdate()),
		)
		this.scheduleUpdate()
	}

	/** The webview can load the view's own files, and the icons and fonts of the file icon theme. */
	private webviewOptions(): vscode.WebviewOptions {
		const iconRoot = this.fileIcons.resourceRoot
		return {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), ...(iconRoot ? [iconRoot] : [])],
		}
	}

	/** Sends the rows again with the file icon theme's current icons. */
	private onDidChangeFileIcons(): void {
		// The new theme's icons can be in another extension's folder. If they are, this reloads the
		// webview, which then asks for the data again.
		if (this.view) {
			this.view.webview.options = this.webviewOptions()
		}
		this.postUpdate()
	}

	/** Stops listening to a repository Git closed, and takes it out of the view. */
	private onDidCloseRepository(repository: Repository): void {
		this.repositoryListeners.get(repository.rootUri.toString())?.dispose()
		this.repositoryListeners.delete(repository.rootUri.toString())
		this.scheduleUpdate()
	}

	/** Updates the view once Git has been quiet for UPDATE_DELAY_MS. */
	private scheduleUpdate(): void {
		clearTimeout(this.refreshTimer)
		this.refreshTimer = setTimeout(() => {
			this.updateNeedsSync()
			this.updateDescription()
			this.postUpdate()
		}, UPDATE_DELAY_MS)
	}

	/** Says next to the view's title when it shows the Repositories panel, and how many need a sync. */
	private updateDescription(): void {
		if (!this.view) return

		const count = this.git.repositories.filter(needsSync).length
		const description = count > 0 ? `Repositories · ${count} to sync` : 'Repositories'
		this.view.description = this.showingRepositories ? description : undefined
	}

	/** Sets `changelist.needsSync` when a repository has commits to push or pull, for the Repositories button. */
	private updateNeedsSync(): void {
		const value = this.git.repositories.some(needsSync)

		if (value !== this.lastNeedsSync) {
			this.lastNeedsSync = value
			void vscode.commands.executeCommand('setContext', 'changelist.needsSync', value)
		}
	}

	/** Sends the page every repository that has changes, unless that is what it shows already. */
	private postUpdate(): void {
		if (!this.view || !this.ready) return

		const viewMode = getViewMode()
		const icons = this.fileIcons.resolver(this.view.webview)
		const repositories = this.git.repositories
			.filter(hasChanges)
			.sort(byName)
			.map(repository => toRepositoryItem(repository, viewMode, icons))
		const message: ExtensionMessage = {
			type: 'update',
			repositories,
			syncRepositories: this.showingRepositories
				? [...this.git.repositories].sort(byName).map(toSyncRepositoryItem)
				: undefined,
			fonts: icons.fonts(),
			alwaysShowActions: vscode.workspace.getConfiguration('scm').get<boolean>('alwaysShowActions', false),
			hoverDelay: vscode.workspace
				.getConfiguration('workbench')
				.get<number>('hover.delay', DEFAULT_HOVER_DELAY_MS),
		}

		// Git reports a change after every status check, also when nothing changed. Drawing the rows
		// again would end the hover and the tooltip under the mouse.
		const json = JSON.stringify(message)
		if (json === this.lastUpdate) {
			return
		}
		this.lastUpdate = json
		this.postMessage(message)
	}

	/** Sends the page a message, once it's ready for one. */
	private postMessage(message: ExtensionMessage): void {
		if (this.view && this.ready) {
			void this.view.webview.postMessage(message)
		}
	}

	/**
	 * Handles a message from the page: it's ready, every repository is collapsed or not, Escape closed
	 * the Repositories panel, or a row's action.
	 */
	private async onDidReceiveMessage(message: WebviewMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
				// A new page, which has nothing yet.
				this.ready = true
				this.lastUpdate = undefined
				this.postUpdate()
				return
			case 'allCollapsed':
				await vscode.commands.executeCommand('setContext', 'changelist.allCollapsed', message.value)
				return
			case 'closeRepositories':
				this.showRepositories(false)
				return
			case 'run': {
				const node = this.resolveTarget(message.target)
				if (!node) {
					return
				}
				try {
					await vscode.commands.executeCommand(`changelist.${message.action}`, node)
				} catch (error) {
					// Commands run from the webview don't get VS Code's own error notification.
					void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
				}
				return
			}
		}
	}
}
