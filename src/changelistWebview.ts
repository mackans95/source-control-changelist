// Keeps the Changelist view up to date: it listens to every repository and the settings the view
// depends on, and sends the webview its data once the page says it's ready. Messages from the page
// run the `changelist.*` commands on the row they came from. The Repositories button in the title
// bar swaps the changes for every repository's sync status, and gets a dot from
// `changelist.needsSync` when a repository has commits to push or pull.
import * as path from 'path'
import * as vscode from 'vscode'
import { viewHtml } from './changelistHtml.ts'
import { toRepositoryItem, toSyncRepositoryItem } from './changelistItems.ts'
import {
	groupChanges,
	hasChanges,
	mainRepository,
	moveInOrder,
	needsSync,
	sortRepositories,
} from './changelistModel.ts'
import { DEFAULT_HOVER_DELAY_MS } from './constants/shared.ts'
import { FileIcons } from './fileIcons.ts'
import type { API, Repository } from './types/git.ts'
import type { Node, ViewMode } from './types/extension.ts'
import type { ActionTarget, ExtensionMessage, WebviewMessage } from './types/shared.ts'
import type { ChangelistStore } from './changelistStore.ts'
import type { Operations } from './operations.ts'
import type { DefaultBranches } from './defaultBranches.ts'
import type { RepositoryOrder } from './repositoryOrder.ts'

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
	// Every repository's changelists.
	private readonly changelists: ChangelistStore
	// Fetch/Pull All and Checkout Default, with each repository's status.
	private readonly operations: Operations
	// Every repository's default branch, for the Repositories panel.
	private readonly defaultBranches: DefaultBranches
	// The order the user dragged the repositories into.
	private readonly repositoryOrder: RepositoryOrder

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

	constructor(
		git: API,
		extensionUri: vscode.Uri,
		changelists: ChangelistStore,
		operations: Operations,
		defaultBranches: DefaultBranches,
		repositoryOrder: RepositoryOrder,
	) {
		this.git = git
		this.extensionUri = extensionUri
		this.changelists = changelists
		this.operations = operations
		this.defaultBranches = defaultBranches
		this.repositoryOrder = repositoryOrder

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
			// The repositories are sorted like the folders, which can be added, removed and reordered.
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.postUpdate()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (
					e.affectsConfiguration('changelist.viewMode') ||
					e.affectsConfiguration('git.autofetch') ||
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

	/**
	 * The view's Refresh button: has Git check every repository's status again, then updates the view.
	 * In the Repositories panel, it looks up the default branches again too.
	 */
	async refresh(): Promise<void> {
		await Promise.all(this.git.repositories.map(r => r.status()))

		if (this.showingRepositories) {
			await this.defaultBranches.refresh(this.git.repositories)
		}

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
			void this.defaultBranches.refresh(this.git.repositories)
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

		const { kind, changelist } = target
		const changes = groupChanges(repository, kind, this.changelists.get(repository), changelist)
		if (!target.uri) {
			return { type: 'group', repository, kind, changelist, changes }
		}

		const change = changes.find(c => c.uri.toString() === target.uri)
		if (change) {
			return { type: 'resource', repository, kind, changelist, change }
		}

		// Not a file, so a folder: the commands only need the changes below it.
		const uri = vscode.Uri.parse(target.uri)
		const prefix = uri.fsPath + path.sep
		return {
			type: 'folder',
			repository,
			kind,
			changelist,
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

	/**
	 * Listens to a repository Git opened, and shows it when it has changes. Each time Git has checked
	 * its status, the files that have no changes any more leave their changelists.
	 */
	private onDidOpenRepository(repository: Repository): void {
		this.repositoryListeners.set(
			repository.rootUri.toString(),
			repository.state.onDidChange(() => {
				this.changelists.prune(repository)
				this.scheduleUpdate()
			}),
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

	/** Every open repository, in the user's order, or else in the order of the workspace's folders. */
	private sortedRepositories(): Repository[] {
		const folders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? []
		return sortRepositories(this.git.repositories, folders, this.repositoryOrder.get())
	}

	/**
	 * Moves a repository right before or after another, and saves the order of every repository that
	 * isn't a worktree below its own. Nothing is saved when the order stays the same.
	 */
	private async moveRepository(repository: string, target: string, after: boolean): Promise<void> {
		const all = this.sortedRepositories()
		const current = all.filter(r => !mainRepository(r, all)).map(r => r.rootUri.toString())
		const order = moveInOrder(current, repository, target, after)

		if (order.some((uri, i) => uri !== current[i])) {
			await this.repositoryOrder.set(order)
		}
	}

	/** Sends the page every repository that has changes, unless that is what it shows already. */
	private postUpdate(): void {
		if (!this.view || !this.ready) return

		const viewMode = getViewMode()
		const icons = this.fileIcons.resolver(this.view.webview)
		// Every open repository, sorted once for both lists.
		const all = this.sortedRepositories()
		// Sorted before they're filtered, so a worktree stays below its repository when both have changes.
		const repositories = all
			.filter(hasChanges)
			.map(repository => toRepositoryItem(repository, this.changelists.get(repository), viewMode, icons))
		const message: ExtensionMessage = {
			type: 'update',
			repositories,
			syncRepositories: this.showingRepositories
				? all.map(r => ({
						...toSyncRepositoryItem(r, all),
						defaultBranch: this.defaultBranches.get(r),
						status: this.operations.get(r),
					}))
				: undefined,
			autoFetch: vscode.workspace.getConfiguration('git').get<boolean | string>('autofetch', false) !== false,
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
	 * the Repositories panel, the panel's notice turns on `git.autofetch`, a repository was dragged,
	 * or a row's action.
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
			case 'turnOnAutoFetch':
				await vscode.workspace
					.getConfiguration('git')
					.update('autofetch', true, vscode.ConfigurationTarget.Global)
				return
			case 'moveRepository':
				await this.moveRepository(message.repository, message.target, message.after)
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
