import type { Change, Repository } from './git'
import type * as vscode from 'vscode'

export type GroupKind = 'merge' | 'staged' | 'changes' | 'untracked'

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

export type ViewMode = 'list' | 'tree'

export type ChangeCategory = 'added' | 'modified' | 'deleted' | 'conflict'

export type ChangeCounts = Record<ChangeCategory, number>

export interface CategoryDisplay {
	/** Shown before the count in the repository's description, like `+3`. */
	readonly symbol: string
	/** Codicon shown in the repository's tooltip. */
	readonly icon: string
	readonly label: string
}
