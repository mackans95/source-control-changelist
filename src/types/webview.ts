// What the extension and the Changelist view's webview send each other. Everything here has to
// survive postMessage, so it's plain data: URIs are strings, and there are no Repository objects.
import type { ChangeCounts, GroupKind } from './shared'

/** How a file's status looks, the same as in the built-in Source Control view. */
export interface StatusDecoration {
	readonly letter: string
	/** Theme color ID, like `gitDecoration.modifiedResourceForeground`. */
	readonly color: string
	/** Shown in the file's tooltip, like `Index Modified`. */
	readonly text: string
	readonly strikethrough: boolean
}

export interface FileItem {
	readonly type: 'file'
	readonly id: string
	readonly uri: string
	readonly name: string
	/** The file's folder relative to the repository, shown next to the name in list mode. Empty in tree mode. */
	readonly folder: string
	readonly letter: string
	/** CSS variable of the theme color for the name and letter. */
	readonly color: string
	readonly strikethrough: boolean
	readonly tooltip: string
}

export interface FolderItem {
	readonly type: 'folder'
	readonly id: string
	readonly uri: string
	readonly label: string
	readonly children: readonly (FolderItem | FileItem)[]
}

export interface GroupItem {
	readonly id: string
	readonly kind: GroupKind
	readonly label: string
	readonly count: number
	readonly children: readonly (FolderItem | FileItem)[]
}

/** Whether the branch has an upstream to sync with, can be published, or isn't a branch (detached HEAD). */
export type SyncState = 'tracking' | 'unpublished' | 'detached'

export interface RepositoryItem {
	/** The repository's root URI. */
	readonly id: string
	readonly name: string
	readonly path: string
	/** The branch name, the short commit for a detached HEAD, or empty before the first commit. */
	readonly branch: string
	readonly sync: SyncState
	readonly ahead: number
	readonly behind: number
	readonly counts: ChangeCounts
	readonly groups: readonly GroupItem[]
}

export type ExtensionMessage =
	| { readonly type: 'update'; readonly repositories: readonly RepositoryItem[] }
	| { readonly type: 'setAllExpanded'; readonly expanded: boolean }

/** The `changelist.*` commands the webview can run. */
export type WebviewAction =
	| 'checkout'
	| 'sync'
	| 'publish'
	| 'commit'
	| 'stageAll'
	| 'unstageAll'
	| 'stage'
	| 'unstage'
	| 'discard'
	| 'openChange'
	| 'openFile'

/**
 * What an action runs on: a repository, a group when `kind` is set, and a folder or file in that
 * group when `uri` is set too.
 */
export interface ActionTarget {
	readonly repository: string
	readonly kind?: GroupKind
	readonly uri?: string
}

export type WebviewMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'run'; readonly action: WebviewAction; readonly target: ActionTarget }
	| { readonly type: 'allCollapsed'; readonly value: boolean }

/** What the webview keeps while it's hidden and reloaded. */
export interface WebviewState {
	readonly collapsed: readonly string[]
}
