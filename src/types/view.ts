import type { Change, Repository } from './git'
import type * as vscode from 'vscode'
import type { GroupKind } from './shared'
import type { FileIcon, IconFont } from './webview'

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

/** The file icon theme's icons, ready for one webview. */
export interface IconResolver {
	fonts(): IconFont[]
	file(uri: vscode.Uri): FileIcon | undefined
	folder(uri: vscode.Uri, expanded: boolean): FileIcon | undefined
}
