// Types only the extension uses, not the webview.
import type * as vscode from 'vscode'
import type { API, Change, Repository } from './git.ts'
import type { FileIcon, GroupKind, IconFont, StagedState } from './shared.ts'
import type { ChangelistStore } from '../state/changelistStore.ts'
import type { DefaultBranches } from '../state/defaultBranches.ts'
import type { HunkTracker } from '../state/hunkTracker.ts'
import type { Operations } from '../state/operations.ts'
import type { RepositoryOrder } from '../state/repositoryOrder.ts'

/** What the extension keeps once Git is ready, which the view and the commands share. */
export interface Services {
	readonly git: API
	readonly changelists: ChangelistStore
	readonly hunks: HunkTracker
	readonly operations: Operations
	readonly defaultBranches: DefaultBranches
	readonly repositoryOrder: RepositoryOrder
}

/** The handlers of some `changelist.*` commands, by their names without `changelist.`. */
export type CommandTable = Readonly<Record<string, (...args: any[]) => unknown>>

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
	/** The list new changes go to. Without one, they stay in Changes and Untracked Changes. */
	readonly active?: string
	/** Each list's description, by its name, which the list's Commit uses as the commit message. */
	readonly descriptions?: Readonly<Record<string, string>>
	/** The changes that are in another list than their file, by the file's URI. */
	readonly hunks?: Readonly<Record<string, FileHunks>>
}

/** A block of changed lines in a file against HEAD, as `git diff -U0` gives it. */
export interface Hunk {
	/** The first of HEAD's lines it replaces, or for an insertion the line it comes after. */
	readonly oldStart: number
	readonly oldLines: number
	/** The first of its lines in the working tree, or for a deletion the line before it. */
	readonly newStart: number
	readonly newLines: number
	/** Its `-` and `+` lines, and Git's `\ No newline at end of file` after the last line that has none. */
	readonly lines: readonly string[]
}

/** A file split between lists, with its changes in one of them. */
export interface FilePart {
	readonly change: Change
	readonly hunks: readonly Hunk[]
}

/** Changes as Stage and Discard take them: whole files, and the parts of split files in one list. */
export interface FileParts {
	readonly whole: readonly Change[]
	readonly split: readonly FilePart[]
}

/** What a file's row shows besides the file: the other lists it's split with, and what's staged. */
export interface FileDetails {
	readonly otherLists: readonly string[]
	readonly staged: StagedState
}

/** A change as the gutter's change peek passes it to its toolbar's commands. Its lines count from 1. */
export interface LineChange {
	readonly originalStartLineNumber: number
	readonly originalEndLineNumber: number
	readonly modifiedStartLineNumber: number
	/** 0 for a deletion, which comes after the start line. */
	readonly modifiedEndLineNumber: number
}

/** A file's changes as read after Git's last check: against HEAD, and when some are staged, which. */
export interface FileDiff {
	readonly hunks: readonly Hunk[]
	/** HEAD against the index, when the file has staged changes. */
	readonly staged?: readonly Hunk[]
	/** The index against the working tree, when the file has staged changes. */
	readonly unstaged?: readonly Hunk[]
}

/** A change saved in another list than its file's: where it is on HEAD's side, and its text. */
export interface SavedHunk {
	readonly oldStart: number
	readonly oldLines: number
	/** Its lines, to find it again after HEAD has moved. */
	readonly text: string
	/** The list it's in, or undefined for Changes. */
	readonly list?: string
}

/** A file's changes that are in other lists than the file, with the HEAD commit their lines are on. */
export interface FileHunks {
	readonly head: string
	readonly hunks: readonly SavedHunk[]
}

/** A changelist in the Move to Changelist picker, or the entry that makes a new one. */
export interface ChangelistPick extends vscode.QuickPickItem {
	/** The list to move to, or undefined for the default Changes list. */
	readonly changelist?: string
	/** The entry that asks for a new list's name first. */
	readonly isNew: boolean
}

/**
 * What the Repositories panel runs on a repository and shows the status of: Fetch All, Pull All and
 * Checkout Default on many at once, and a row's own buttons on one.
 */
export type OperationKind = 'fetch' | 'pull' | 'push' | 'sync' | 'publish' | 'checkout'

/** The repositories Checkout Default switches, with their branch, and the ones it skips, with why. */
export interface CheckoutPlan {
	readonly targets: Map<Repository, string>
	readonly skipped: [Repository, string][]
}

/** How an operation is named while it runs, when it's done, and when it fails. */
export interface OperationLabels {
	/** Its button's name, for "Fetch All is still running". */
	readonly name: string
	readonly running: string
	readonly done: string
	/** The verb in "Couldn't fetch api, web". */
	readonly verb: string
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
