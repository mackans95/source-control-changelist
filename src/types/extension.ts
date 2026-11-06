// Types only the extension uses: the nodes the `changelist.*` commands take, and what the provider
// works with while it turns repositories into the webview's data.
import type * as vscode from 'vscode'
import type { Change, Repository } from './git.ts'
import type { FileIcon, GroupKind, IconFont } from './shared.ts'

/** How the view lays out a group's files: a flat list that shows their folders, or a folder tree. */
export type ViewMode = 'list' | 'tree'

/** A repository's row. */
export interface RepositoryNode {
	readonly type: 'repository'
	readonly repository: Repository
}

/** A group's or changelist's row, with its changes. */
export interface GroupNode {
	readonly type: 'group'
	readonly repository: Repository
	readonly kind: GroupKind
	/** A changelist's name. */
	readonly changelist?: string
	readonly changes: readonly Change[]
}

/** A file's row: one change in a group or changelist. */
export interface ResourceNode {
	readonly type: 'resource'
	readonly repository: Repository
	readonly kind: GroupKind
	readonly changelist?: string
	readonly change: Change
}

/** A folder's row in tree mode, with the changes and rows below it. */
export interface FolderNode {
	readonly type: 'folder'
	readonly repository: Repository
	readonly kind: GroupKind
	readonly changelist?: string
	readonly uri: vscode.Uri
	readonly label: string
	/** All changes below this folder. */
	readonly changes: readonly Change[]
	readonly children: readonly (FolderNode | ResourceNode)[]
}

/** Any row, as the `changelist.*` commands take it. */
export type Node = RepositoryNode | GroupNode | FolderNode | ResourceNode

/**
 * A repository's changelists, as they're saved in the workspace's state. Files that aren't in
 * `files` are in the default Changes list, or in Untracked Changes.
 */
export interface RepositoryChangelists {
	/** The lists the user made, in the order they were made. */
	readonly lists: readonly string[]
	/** Which list each moved file is in, by the file's URI. */
	readonly files: Readonly<Record<string, string>>
}

/** A changelist in the Move to Changelist picker, or the entry that makes a new one. */
export interface ChangelistPick extends vscode.QuickPickItem {
	/** The list to move to, or undefined for the default Changes list. */
	readonly changelist?: string
	/** The entry that asks for a new list's name first. */
	readonly isNew: boolean
}

/** A folder while buildTree sorts a group's changes into folders. */
export interface Directory {
	readonly directories: Map<string, Directory>
	readonly files: Change[]
}

/** The file icon theme's icons, ready for one webview. */
export interface IconResolver {
	fonts(): IconFont[]
	file(uri: vscode.Uri): FileIcon | undefined
	folder(uri: vscode.Uri, expanded: boolean): FileIcon | undefined
}

/** How a file's status looks, the same as in the built-in Source Control view. */
export interface StatusDecoration {
	readonly letter: string
	/** Theme color ID, like `gitDecoration.modifiedResourceForeground`. */
	readonly color: string
	/** Shown in the file's tooltip, like `Index Modified`. */
	readonly text: string
	readonly strikethrough: boolean
}
