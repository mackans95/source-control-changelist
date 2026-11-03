// Types only the extension uses: the nodes the `changelist.*` commands take, and what the provider
// works with while it turns repositories into the webview's data.
import type * as vscode from 'vscode'
import type { Change, Repository } from './git.ts'
import type { FileIcon, GroupKind, IconFont } from './shared.ts'

export type ViewMode = 'list' | 'tree'

export interface RepositoryNode {
	readonly type: 'repository'
	readonly repository: Repository
}

export interface GroupNode {
	readonly type: 'group'
	readonly repository: Repository
	readonly kind: GroupKind
	readonly changes: readonly Change[]
}

export interface ResourceNode {
	readonly type: 'resource'
	readonly repository: Repository
	readonly kind: GroupKind
	readonly change: Change
}

export interface FolderNode {
	readonly type: 'folder'
	readonly repository: Repository
	readonly kind: GroupKind
	readonly uri: vscode.Uri
	readonly label: string
	/** All changes below this folder. */
	readonly changes: readonly Change[]
	readonly children: readonly (FolderNode | ResourceNode)[]
}

export type Node = RepositoryNode | GroupNode | FolderNode | ResourceNode

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
