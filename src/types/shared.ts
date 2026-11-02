// Types both the extension and the webview's script use. Nothing here may depend on the vscode or
// Node APIs, which the webview doesn't have.

export type GroupKind = 'merge' | 'staged' | 'changes' | 'untracked'

export type ViewMode = 'list' | 'tree'

export type ChangeCategory = 'added' | 'modified' | 'deleted' | 'conflict'

export type ChangeCounts = Record<ChangeCategory, number>

export interface CategoryDisplay {
	/** Codicon shown before the count on the repository's row. */
	readonly icon: string
	/** Follows the count in the row's tooltip, like `3 added`. */
	readonly label: string
	/** CSS variable of the theme color for the icon and count. */
	readonly color: string
}
