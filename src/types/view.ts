import type { Change, Repository } from './git'
import type * as vscode from 'vscode'
import type { GroupKind } from './shared'

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
