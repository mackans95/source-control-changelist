// What the view's rows show of each repository: Git's state turned into the plain data the webview
// draws, for the changes and for the Repositories panel. It doesn't use `vscode`, so the tests can
// run it in Node.
import * as path from 'path'
import {
	GROUP_LABELS,
	buildTree,
	byPath,
	countChanges,
	getChanges,
	needsSync,
	repositoryName,
	syncState,
} from './changelistModel.ts'
import { Status } from './constants/git.ts'
import { themeColor } from './helpers/shared.ts'
import type { Change, Repository } from './types/git.ts'
import type { FolderNode, IconResolver, ResourceNode, StatusDecoration, ViewMode } from './types/extension.ts'
import type { FileItem, FolderItem, GroupItem, GroupKind, RepositoryItem, SyncRepositoryItem } from './types/shared.ts'

// The same letters, colors and texts as the Git extension uses in the built-in Source Control view.
const STATUS_DECORATIONS: Record<(typeof Status)[keyof typeof Status], StatusDecoration> = {
	[Status.INDEX_MODIFIED]: {
		letter: 'M',
		color: 'gitDecoration.stageModifiedResourceForeground',
		text: 'Index Modified',
		strikethrough: false,
	},
	[Status.INDEX_ADDED]: {
		letter: 'A',
		color: 'gitDecoration.addedResourceForeground',
		text: 'Index Added',
		strikethrough: false,
	},
	[Status.INDEX_DELETED]: {
		letter: 'D',
		color: 'gitDecoration.stageDeletedResourceForeground',
		text: 'Index Deleted',
		strikethrough: true,
	},
	[Status.INDEX_RENAMED]: {
		letter: 'R',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Index Renamed',
		strikethrough: false,
	},
	[Status.INDEX_COPIED]: {
		letter: 'C',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Index Copied',
		strikethrough: false,
	},
	[Status.MODIFIED]: {
		letter: 'M',
		color: 'gitDecoration.modifiedResourceForeground',
		text: 'Modified',
		strikethrough: false,
	},
	[Status.DELETED]: {
		letter: 'D',
		color: 'gitDecoration.deletedResourceForeground',
		text: 'Deleted',
		strikethrough: true,
	},
	[Status.UNTRACKED]: {
		letter: 'U',
		color: 'gitDecoration.untrackedResourceForeground',
		text: 'Untracked',
		strikethrough: false,
	},
	[Status.IGNORED]: {
		letter: 'I',
		color: 'gitDecoration.ignoredResourceForeground',
		text: 'Ignored',
		strikethrough: false,
	},
	[Status.INTENT_TO_ADD]: {
		letter: 'A',
		color: 'gitDecoration.addedResourceForeground',
		text: 'Intent to Add',
		strikethrough: false,
	},
	[Status.INTENT_TO_RENAME]: {
		letter: 'R',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Intent to Rename',
		strikethrough: false,
	},
	[Status.TYPE_CHANGED]: {
		letter: 'T',
		color: 'gitDecoration.modifiedResourceForeground',
		text: 'Type Changed',
		strikethrough: false,
	},
	[Status.ADDED_BY_US]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Added By Us',
		strikethrough: false,
	},
	[Status.ADDED_BY_THEM]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Added By Them',
		strikethrough: false,
	},
	[Status.DELETED_BY_US]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Deleted By Us',
		strikethrough: true,
	},
	[Status.DELETED_BY_THEM]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Deleted By Them',
		strikethrough: true,
	},
	[Status.BOTH_ADDED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Added',
		strikethrough: false,
	},
	[Status.BOTH_DELETED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Deleted',
		strikethrough: true,
	},
	[Status.BOTH_MODIFIED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Modified',
		strikethrough: false,
	},
}

/** The branch's name, or for a detached HEAD its short commit like the built-in view shows it. */
function branchLabel(repository: Repository): string {
	const head = repository.state.HEAD

	return head?.name ?? head?.commit?.slice(0, 8) ?? ''
}

/** A file's row: its name, icon and status, and its folder in list mode. */
function toFileItem(
	repository: Repository,
	kind: GroupKind,
	change: Change,
	viewMode: ViewMode,
	icons: IconResolver,
): FileItem {
	const decoration = STATUS_DECORATIONS[change.status]
	const relativePath = path.relative(repository.rootUri.fsPath, change.uri.fsPath)
	const folder = path.dirname(relativePath)
	return {
		type: 'file',
		id: `${repository.rootUri}#${kind}#${change.uri}`,
		uri: change.uri.toString(),
		name: path.basename(change.uri.fsPath),
		icon: icons.file(change.uri),
		folder: viewMode === 'list' && folder !== '.' ? folder : '',
		letter: decoration.letter,
		color: themeColor(decoration.color),
		strikethrough: decoration.strikethrough,
		tooltip: `${relativePath} • ${decoration.text}`,
	}
}

/** A folder's or file's row in tree mode, with the rows below a folder. */
function toEntry(node: FolderNode | ResourceNode, viewMode: ViewMode, icons: IconResolver): FolderItem | FileItem {
	if (node.type === 'resource') {
		return toFileItem(node.repository, node.kind, node.change, viewMode, icons)
	}
	return {
		type: 'folder',
		id: `${node.repository.rootUri}#${node.kind}#${node.uri}`,
		uri: node.uri.toString(),
		label: node.label,
		icon: icons.folder(node.uri, false),
		expandedIcon: icons.folder(node.uri, true),
		children: node.children.map(child => toEntry(child, viewMode, icons)),
	}
}

/** A group's row, with its files: in folders in tree mode, or sorted by path in list mode. */
function toGroupItem(repository: Repository, kind: GroupKind, viewMode: ViewMode, icons: IconResolver): GroupItem {
	const changes = getChanges(repository, kind)
	const children =
		viewMode === 'tree'
			? buildTree(repository, kind, changes).map(node => toEntry(node, viewMode, icons))
			: [...changes].sort(byPath).map(change => toFileItem(repository, kind, change, viewMode, icons))
	return { id: `${repository.rootUri}#${kind}`, kind, label: GROUP_LABELS[kind], count: changes.length, children }
}

/** A repository's row, with its counts and the groups that have changes. */
export function toRepositoryItem(repository: Repository, viewMode: ViewMode, icons: IconResolver): RepositoryItem {
	return {
		id: repository.rootUri.toString(),
		name: repositoryName(repository),
		path: repository.rootUri.fsPath,
		branch: branchLabel(repository),
		counts: countChanges(repository),
		groups: (Object.keys(GROUP_LABELS) as GroupKind[])
			.filter(kind => getChanges(repository, kind).length > 0)
			.map(kind => toGroupItem(repository, kind, viewMode, icons)),
	}
}

/** A repository's row in the Repositories panel: its branch, and how far that is from its upstream. */
export function toSyncRepositoryItem(repository: Repository): SyncRepositoryItem {
	const head = repository.state.HEAD

	return {
		id: repository.rootUri.toString(),
		name: repositoryName(repository),
		path: repository.rootUri.fsPath,
		branch: branchLabel(repository),
		state: syncState(repository),
		ahead: head?.ahead ?? 0,
		behind: head?.behind ?? 0,
		needsSync: needsSync(repository),
	}
}
