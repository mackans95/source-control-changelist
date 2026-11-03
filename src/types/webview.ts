// What the extension and the Changelist view's webview send each other. Everything here has to
// survive postMessage, so it's plain data: URIs are strings, and there are no Repository objects.
import type { ChangeCounts, GroupKind } from './shared.ts'

/** How a file's status looks, the same as in the built-in Source Control view. */
export interface StatusDecoration {
	readonly letter: string
	/** Theme color ID, like `gitDecoration.modifiedResourceForeground`. */
	readonly color: string
	/** Shown in the file's tooltip, like `Index Modified`. */
	readonly text: string
	readonly strikethrough: boolean
}

/** A file or folder icon from the file icon theme. */
export type FileIcon =
	| {
			readonly type: 'font'
			readonly character: string
			readonly family: string
			readonly color?: string
			readonly size?: string
			readonly weight?: string
			readonly style?: string
	  }
	| {
			readonly type: 'image'
			readonly uri: string
			/** Drawn in the text color, for themes whose images use `currentColor`. */
			readonly mask: boolean
	  }

/** A font of the file icon theme, for the webview to load. */
export interface IconFont {
	readonly family: string
	/** A CSS `src`, like `url("...") format("woff")`. */
	readonly src: string
	readonly weight?: string
	readonly style?: string
}

export interface FileItem {
	readonly type: 'file'
	readonly id: string
	readonly uri: string
	readonly name: string
	readonly icon?: FileIcon
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
	readonly icon?: FileIcon
	readonly expandedIcon?: FileIcon
	readonly children: readonly (FolderItem | FileItem)[]
}

export interface GroupItem {
	readonly id: string
	readonly kind: GroupKind
	readonly label: string
	readonly count: number
	readonly children: readonly (FolderItem | FileItem)[]
}

export interface RepositoryItem {
	/** The repository's root URI. */
	readonly id: string
	readonly name: string
	readonly path: string
	/** The branch name, the short commit for a detached HEAD, or empty before the first commit. */
	readonly branch: string
	readonly counts: ChangeCounts
	readonly groups: readonly GroupItem[]
}

export type ExtensionMessage =
	| {
			readonly type: 'update'
			readonly repositories: readonly RepositoryItem[]
			readonly fonts: readonly IconFont[]
			/** VS Code's `scm.alwaysShowActions`: show the actions on every row, not just on hover. */
			readonly alwaysShowActions: boolean
			/** VS Code's `workbench.hover.delay`: how long the mouse rests before a tooltip shows, in milliseconds. */
			readonly hoverDelay: number
	  }
	| { readonly type: 'setAllExpanded'; readonly expanded: boolean }

/** The `changelist.*` commands the webview can run. */
export type WebviewAction =
	| 'checkout'
	| 'commit'
	| 'stageAll'
	| 'unstageAll'
	| 'stage'
	| 'unstage'
	| 'discard'
	| 'discardAll'
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

/** The kinds of rows, for the right-click menu's `when` clauses. */
export type RowSection = 'repository' | 'group' | 'folder' | 'file'

/**
 * A row's `data-vscode-context`. Its properties are context keys in the right-click menu's `when`
 * clauses, and VS Code passes it to the command that runs.
 */
export interface MenuContext extends ActionTarget {
	readonly webviewSection: RowSection
	readonly preventDefaultContextMenuItems: true
}

export type WebviewMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'run'; readonly action: WebviewAction; readonly target: ActionTarget }
	| { readonly type: 'allCollapsed'; readonly value: boolean }

/** What the webview keeps while it's hidden and reloaded. */
export interface WebviewState {
	readonly collapsed: readonly string[]
}
