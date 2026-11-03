import { randomBytes } from 'crypto'
import * as path from 'path'
import * as vscode from 'vscode'
import {
	GROUP_LABELS,
	buildTree,
	byPath,
	countChanges,
	getChanges,
	getViewMode,
	hasChanges,
	repositoryName,
} from './changelistModel'
import { Status } from './constants'
import { FileIcons } from './fileIcons'
import type { API, Change, Repository } from './types/git'
import type { GroupKind, ViewMode } from './types/shared'
import type { FolderNode, IconResolver, Node, ResourceNode } from './types/view'
import type {
	ActionTarget,
	ExtensionMessage,
	FileItem,
	FolderItem,
	GroupItem,
	RepositoryItem,
	StatusDecoration,
	WebviewMessage,
} from './types/webview'

// The same letters, colors and texts as the Git extension uses in the built-in Source Control view.
const STATUS_DECORATIONS: Record<(typeof Status)[keyof typeof Status], StatusDecoration> = {
	[Status.INDEX_MODIFIED]: {
		letter: 'M',
		color: 'gitDecoration.stageModifiedResourceForeground',
		text: 'Index Modified',
		strikethrough: false,
	},
	[Status.INDEX_ADDED]: {
		letter: 'A',
		color: 'gitDecoration.addedResourceForeground',
		text: 'Index Added',
		strikethrough: false,
	},
	[Status.INDEX_DELETED]: {
		letter: 'D',
		color: 'gitDecoration.stageDeletedResourceForeground',
		text: 'Index Deleted',
		strikethrough: true,
	},
	[Status.INDEX_RENAMED]: {
		letter: 'R',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Index Renamed',
		strikethrough: false,
	},
	[Status.INDEX_COPIED]: {
		letter: 'C',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Index Copied',
		strikethrough: false,
	},
	[Status.MODIFIED]: {
		letter: 'M',
		color: 'gitDecoration.modifiedResourceForeground',
		text: 'Modified',
		strikethrough: false,
	},
	[Status.DELETED]: {
		letter: 'D',
		color: 'gitDecoration.deletedResourceForeground',
		text: 'Deleted',
		strikethrough: true,
	},
	[Status.UNTRACKED]: {
		letter: 'U',
		color: 'gitDecoration.untrackedResourceForeground',
		text: 'Untracked',
		strikethrough: false,
	},
	[Status.IGNORED]: {
		letter: 'I',
		color: 'gitDecoration.ignoredResourceForeground',
		text: 'Ignored',
		strikethrough: false,
	},
	[Status.INTENT_TO_ADD]: {
		letter: 'A',
		color: 'gitDecoration.addedResourceForeground',
		text: 'Intent to Add',
		strikethrough: false,
	},
	[Status.INTENT_TO_RENAME]: {
		letter: 'R',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Intent to Rename',
		strikethrough: false,
	},
	[Status.TYPE_CHANGED]: {
		letter: 'T',
		color: 'gitDecoration.modifiedResourceForeground',
		text: 'Type Changed',
		strikethrough: false,
	},
	[Status.ADDED_BY_US]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Added By Us',
		strikethrough: false,
	},
	[Status.ADDED_BY_THEM]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Added By Them',
		strikethrough: false,
	},
	[Status.DELETED_BY_US]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Deleted By Us',
		strikethrough: true,
	},
	[Status.DELETED_BY_THEM]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Deleted By Them',
		strikethrough: true,
	},
	[Status.BOTH_ADDED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Added',
		strikethrough: false,
	},
	[Status.BOTH_DELETED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Deleted',
		strikethrough: true,
	},
	[Status.BOTH_MODIFIED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Modified',
		strikethrough: false,
	},
}

/** Theme colors are CSS variables in webviews, with the dot as a dash: `--vscode-gitDecoration-…`. */
function cssVariable(themeColor: string): string {
	return `--vscode-${themeColor.replace(/\./g, '-')}`
}

function toFileItem(
	repository: Repository,
	kind: GroupKind,
	change: Change,
	viewMode: ViewMode,
	icons: IconResolver,
): FileItem {
	const decoration = STATUS_DECORATIONS[change.status]
	const relativePath = path.relative(repository.rootUri.fsPath, change.uri.fsPath)
	const folder = path.dirname(relativePath)
	return {
		type: 'file',
		id: `${repository.rootUri}#${kind}#${change.uri}`,
		uri: change.uri.toString(),
		name: path.basename(change.uri.fsPath),
		icon: icons.file(change.uri),
		folder: viewMode === 'list' && folder !== '.' ? folder : '',
		letter: decoration.letter,
		color: cssVariable(decoration.color),
		strikethrough: decoration.strikethrough,
		tooltip: `${relativePath} • ${decoration.text}`,
	}
}

function toEntry(node: FolderNode | ResourceNode, viewMode: ViewMode, icons: IconResolver): FolderItem | FileItem {
	if (node.type === 'resource') {
		return toFileItem(node.repository, node.kind, node.change, viewMode, icons)
	}
	return {
		type: 'folder',
		id: `${node.repository.rootUri}#${node.kind}#${node.uri}`,
		uri: node.uri.toString(),
		label: node.label,
		icon: icons.folder(node.uri, false),
		expandedIcon: icons.folder(node.uri, true),
		children: node.children.map(child => toEntry(child, viewMode, icons)),
	}
}

function toGroupItem(repository: Repository, kind: GroupKind, viewMode: ViewMode, icons: IconResolver): GroupItem {
	const changes = getChanges(repository, kind)
	const children =
		viewMode === 'tree'
			? buildTree(repository, kind, changes).map(node => toEntry(node, viewMode, icons))
			: [...changes].sort(byPath).map(change => toFileItem(repository, kind, change, viewMode, icons))
	return { id: `${repository.rootUri}#${kind}`, kind, label: GROUP_LABELS[kind], count: changes.length, children }
}

function toRepositoryItem(repository: Repository, viewMode: ViewMode, icons: IconResolver): RepositoryItem {
	const head = repository.state.HEAD
	return {
		id: repository.rootUri.toString(),
		name: repositoryName(repository),
		path: repository.rootUri.fsPath,
		// A detached HEAD has no branch name, so show its commit like the built-in view does.
		branch: head?.name ?? head?.commit?.slice(0, 8) ?? '',
		sync: head?.upstream ? 'tracking' : head?.name ? 'unpublished' : 'detached',
		ahead: head?.ahead ?? 0,
		behind: head?.behind ?? 0,
		counts: countChanges(repository),
		groups: (Object.keys(GROUP_LABELS) as GroupKind[])
			.filter(kind => getChanges(repository, kind).length > 0)
			.map(kind => toGroupItem(repository, kind, viewMode, icons)),
	}
}

/**
 * The Changelist view: repositories that have changes, grouped like the built-in Source Control
 * view. It's a webview rather than a tree view so it can have text buttons, bold names and
 * colored counts. Clean repositories are left out, so the view is empty when nothing has changed.
 */
export class ChangelistWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view: vscode.WebviewView | undefined
	// The webview's page loads again each time the view is shown, and says when it's ready for data.
	private ready = false
	private readonly disposables: vscode.Disposable[] = []
	private viewDisposables: vscode.Disposable[] = []
	// Keyed by root URI: `git.repositories` returns new wrapper objects on every call.
	private readonly repositoryListeners = new Map<string, vscode.Disposable>()
	private refreshTimer: NodeJS.Timeout | undefined
	// What the webview shows now, as JSON, so it isn't sent the same update again.
	private lastUpdate: string | undefined
	private readonly fileIcons = new FileIcons()

	constructor(
		private readonly git: API,
		private readonly extensionUri: vscode.Uri,
	) {
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

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.viewDisposables.forEach(d => d.dispose())
		this.view = webviewView
		this.ready = false

		const dist = vscode.Uri.joinPath(this.extensionUri, 'dist')
		webviewView.webview.options = this.webviewOptions()
		webviewView.webview.html = this.getHtml(webviewView.webview, dist)

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

	async refresh(): Promise<void> {
		await Promise.all(this.git.repositories.map(r => r.status()))
		this.postUpdate()
	}

	setAllExpanded(expanded: boolean): void {
		this.postMessage({ type: 'setAllExpanded', expanded })
	}

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

	private onDidChangeFileIcons(): void {
		// The new theme's icons can be in another extension's folder. If they are, this reloads the
		// webview, which then asks for the data again.
		if (this.view) {
			this.view.webview.options = this.webviewOptions()
		}
		this.postUpdate()
	}

	private onDidCloseRepository(repository: Repository): void {
		this.repositoryListeners.get(repository.rootUri.toString())?.dispose()
		this.repositoryListeners.delete(repository.rootUri.toString())
		this.scheduleUpdate()
	}

	private scheduleUpdate(): void {
		clearTimeout(this.refreshTimer)
		this.refreshTimer = setTimeout(() => this.postUpdate(), 100)
	}

	private postUpdate(): void {
		if (!this.view || !this.ready) return

		const viewMode = getViewMode()
		const icons = this.fileIcons.resolver(this.view.webview)
		const repositories = this.git.repositories
			.filter(hasChanges)
			.sort((a, b) => repositoryName(a).localeCompare(repositoryName(b)))
			.map(repository => toRepositoryItem(repository, viewMode, icons))
		const message: ExtensionMessage = {
			type: 'update',
			repositories,
			fonts: icons.fonts(),
			alwaysShowActions: vscode.workspace.getConfiguration('scm').get<boolean>('alwaysShowActions', false),
			hoverDelay: vscode.workspace.getConfiguration('workbench').get<number>('hover.delay', 500),
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

	private postMessage(message: ExtensionMessage): void {
		if (this.view && this.ready) {
			void this.view.webview.postMessage(message)
		}
	}

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

	/** Turns a target from the webview back into the node the `changelist.*` commands take. */
	private resolveTarget(target: ActionTarget): Node | undefined {
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

	private getHtml(webview: vscode.Webview, dist: vscode.Uri): string {
		const nonce = randomBytes(16).toString('base64')
		const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'))
		const styles = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'))
		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource}`,
			`img-src ${webview.cspSource}`,
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
		].join('; ')

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styles}">
</head>
<body>
	<div id="root" role="tree" aria-label="Changelist"></div>
	<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
	}

	dispose(): void {
		clearTimeout(this.refreshTimer)
		this.repositoryListeners.forEach(d => d.dispose())
		this.viewDisposables.forEach(d => d.dispose())
		this.disposables.forEach(d => d.dispose())
	}
}
