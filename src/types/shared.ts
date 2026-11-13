// The types both the extension and the webview use: the rows' data and their messages. It's all
// plain data, with URIs as strings, since it goes through postMessage.

/** The groups of changes, like in the built-in Source Control view. */
export type GroupKind = 'merge' | 'staged' | 'changes' | 'untracked'

/** The kinds of changes a repository's row counts. */
export type ChangeCategory = 'added' | 'modified' | 'deleted' | 'conflict'

/** How many files of each kind a repository has changed. */
export type ChangeCounts = Record<ChangeCategory, number>

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

/** How much of a file's changes are staged. */
export type StagedState = 'none' | 'some' | 'all'

/** A file's row. */
export interface FileItem {
	readonly type: 'file'
	readonly id: string
	readonly uri: string
	readonly name: string
	readonly icon?: FileIcon
	/** The file's folder relative to the repository, shown next to the name in list mode. Empty in tree mode. */
	readonly folder: string
	readonly letter: string
	/** The theme color for the name and letter, as a CSS value like `var(--vscode-…)`. */
	readonly color: string
	readonly strikethrough: boolean
	readonly tooltip: string
	/** For a file split between lists, the other lists its changes are in. */
	readonly otherLists: readonly string[]
	/** In a changelist, whether the file's changes are staged: none, some, or all of them. */
	readonly staged: StagedState
}

/** A folder's row in tree mode, with the rows below it. */
export interface FolderItem {
	readonly type: 'folder'
	readonly id: string
	readonly uri: string
	readonly label: string
	readonly icon?: FileIcon
	readonly expandedIcon?: FileIcon
	/** In a changelist, how much of its files' changes are staged. */
	readonly staged: StagedState
	readonly children: readonly (FolderItem | FileItem)[]
}

/** A group's or changelist's row, with the rows below it. */
export interface GroupItem {
	readonly id: string
	readonly kind: GroupKind
	/** A changelist's name. Its `kind` is `changes`, and it has files from Untracked Changes too. */
	readonly changelist?: string
	readonly label: string
	/** A changelist's description, shown after its name. */
	readonly description?: string
	readonly count: number
	/** Whether new changes go here: the active changelist, or Changes when no list is active. */
	readonly active: boolean
	/** For a changelist, how much of its files' changes are staged. */
	readonly staged: StagedState
	readonly children: readonly (FolderItem | FileItem)[]
}

/** A repository of its own, a worktree of one, or a submodule, like the Git extension's `Repository.kind`. */
export type RepositoryKind = 'repository' | 'worktree' | 'submodule'

/** A repository's row, with its groups. */
export interface RepositoryItem {
	/** The repository's root URI. */
	readonly id: string
	readonly name: string
	readonly path: string
	/** Which icon it gets. */
	readonly kind: RepositoryKind
	/** For a worktree, the name of the repository it belongs to. */
	readonly worktreeOf?: string
	/** The branch name, the short commit for a detached HEAD, or empty before the first commit. */
	readonly branch: string
	readonly counts: ChangeCounts
	readonly groups: readonly GroupItem[]
}

/** Where a repository's branch stands against its upstream. */
export type SyncState = 'synced' | 'ahead' | 'behind' | 'diverged' | 'unpublished' | 'detached'

/** Where Fetch All, Pull All or Checkout Default is with a repository. */
export type OperationState = 'running' | 'done' | 'failed' | 'skipped'

/** What Fetch All, Pull All or Checkout Default is doing with a repository, shown at the end of its row. */
export interface OperationStatus {
	readonly state: OperationState
	/** The status icon's tooltip: what it's doing, or why it failed or was skipped. */
	readonly message: string
}

/** A repository's row in the Repositories panel. */
export interface SyncRepositoryItem {
	/** The repository's root URI. */
	readonly id: string
	readonly name: string
	readonly path: string
	/** Which icon it gets. */
	readonly kind: RepositoryKind
	/** For a worktree, the name of the repository it belongs to. */
	readonly worktreeOf?: string
	/** The branch name, the short commit for a detached HEAD, or empty before the first commit. */
	readonly branch: string
	readonly state: SyncState
	/** How many commits there are to push. */
	readonly ahead: number
	/** How many commits there are to pull, as far as Git knows since its last fetch. */
	readonly behind: number
	/** Whether it has commits to push or pull, which makes its name bold. */
	readonly needsSync: boolean
	/** Whether it has uncommitted changes, which puts a `*` after its name. */
	readonly hasChanges: boolean
	/** For a worktree, the id of the repository it belongs to, when that one is open too. */
	readonly parentId?: string
	/** The branch Checkout Default switches to, once it's been looked up. */
	readonly defaultBranch?: string
	/** What Fetch All, Pull All or Checkout Default last did with it. */
	readonly status?: OperationStatus
}

/** What the extension sends the webview: the rows to draw, or to expand or collapse them all. */
export type ExtensionMessage =
	| {
			readonly type: 'update'
			readonly repositories: readonly RepositoryItem[]
			/** Every repository, while the Repositories panel is shown instead of the changes. */
			readonly syncRepositories?: readonly SyncRepositoryItem[]
			/** The Git extension's `git.autofetch`. Without it, the panel says how to turn it on. */
			readonly autoFetch: boolean
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
	| 'push'
	| 'pull'
	| 'sync'
	| 'publish'
	| 'commit'
	| 'commitChangelist'
	| 'stageAll'
	| 'unstageAll'
	| 'stage'
	| 'unstage'
	| 'discard'
	| 'discardAll'
	| 'openChange'
	| 'openFile'

/** What an action runs on: a repository, a group with `kind`, or a folder or file in it with `uri` too. */
export interface ActionTarget {
	readonly repository: string
	readonly kind?: GroupKind
	readonly changelist?: string
	readonly uri?: string
}

/** The kinds of rows, for the right-click menu's `when` clauses. `sync` is a repository in the Repositories panel. */
export type RowSection = 'repository' | 'group' | 'folder' | 'file' | 'sync'

/** What a row's right-click menu knows about the row, for its `when` clauses. */
export interface RowContext extends ActionTarget {
	/** On a group's row, whether new changes go there, so Set as Active Changelist is left out. */
	readonly active?: boolean
}

/** A row's `data-vscode-context`, which VS Code passes to the menu item's command. */
export interface MenuContext extends RowContext {
	readonly webviewSection: RowSection
	readonly preventDefaultContextMenuItems: true
}

/** What the webview sends the extension. */
export type WebviewMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'run'; readonly action: WebviewAction; readonly target: ActionTarget }
	| { readonly type: 'allCollapsed'; readonly value: boolean }
	| { readonly type: 'closeRepositories' }
	| { readonly type: 'turnOnAutoFetch' }
	| { readonly type: 'moveRepository'; readonly repository: string; readonly target: string; readonly after: boolean }
	| { readonly type: 'dropChanges'; readonly source: ActionTarget; readonly target: ActionTarget }
