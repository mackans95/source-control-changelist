// The rows' data: each repository's state turned into the plain data the webview draws.
import * as path from 'path'
import { STATUS_DECORATIONS } from '../constants/statusDecorations.ts'
import { themeColor } from '../helpers/shared.ts'
import { GROUP_LABELS, countChanges, hasChanges } from '../model/changes.ts'
import { groupChanges } from '../model/changelists.ts'
import { mainRepository, mainRepositoryPath, repositoryName } from '../model/repositories.ts'
import { needsSync, syncState } from '../model/sync.ts'
import { buildTree, byPath } from '../model/tree.ts'
import type { FolderNode, IconResolver, RepositoryChangelists, ResourceNode, ViewMode } from '../types/extension.ts'
import type { Change, Repository } from '../types/git.ts'
import type {
	FileItem,
	FolderItem,
	GroupItem,
	GroupKind,
	RepositoryItem,
	RepositoryKind,
	SyncRepositoryItem,
} from '../types/shared.ts'

/** A repository's row with its groups that have changes, and all its changelists after Changes. */
export function toRepositoryItem(
	repository: Repository,
	changelists: RepositoryChangelists,
	viewMode: ViewMode,
	icons: IconResolver,
): RepositoryItem {
	const groups = (kinds: GroupKind[]) =>
		kinds
			.filter(kind => groupChanges(repository, kind, changelists).length > 0)
			.map(kind => toGroupItem(repository, changelists, kind, undefined, viewMode, icons))

	return {
		id: repository.rootUri.toString(),
		name: repositoryName(repository),
		path: repository.rootUri.fsPath,
		kind: repositoryKind(repository),
		worktreeOf: worktreeOf(repository),
		branch: branchLabel(repository),
		counts: countChanges(repository),
		groups: [
			...groups(['merge', 'staged', 'changes']),
			...changelists.lists.map(name => toGroupItem(repository, changelists, 'changes', name, viewMode, icons)),
			...groups(['untracked']),
		],
	}
}

/** A repository's row in the Repositories panel. A worktree's repository is looked for in `repositories`. */
export function toSyncRepositoryItem(repository: Repository, repositories: readonly Repository[]): SyncRepositoryItem {
	const head = repository.state.HEAD

	return {
		id: repository.rootUri.toString(),
		name: repositoryName(repository),
		path: repository.rootUri.fsPath,
		kind: repositoryKind(repository),
		worktreeOf: worktreeOf(repository),
		branch: branchLabel(repository),
		state: syncState(repository),
		ahead: head?.ahead ?? 0,
		behind: head?.behind ?? 0,
		needsSync: needsSync(repository),
		hasChanges: hasChanges(repository),
		parentId: mainRepository(repository, repositories)?.rootUri.toString(),
	}
}

/** A repository of its own, a worktree or a submodule. Older versions of the Git extension don't say. */
function repositoryKind(repository: Repository): RepositoryKind {
	return repository.kind ?? 'repository'
}

/** For a worktree, the name of the repository it belongs to. */
function worktreeOf(repository: Repository): string | undefined {
	const mainPath = mainRepositoryPath(repository)
	return mainPath ? path.basename(mainPath) : undefined
}

/** The branch's name, or for a detached HEAD its short commit like the built-in view shows it. */
function branchLabel(repository: Repository): string {
	const head = repository.state.HEAD

	return head?.name ?? head?.commit?.slice(0, 8) ?? ''
}

/** A group's or changelist's row, with its files in folders in tree mode, or sorted by path in list mode. */
function toGroupItem(
	repository: Repository,
	changelists: RepositoryChangelists,
	kind: GroupKind,
	changelist: string | undefined,
	viewMode: ViewMode,
	icons: IconResolver,
): GroupItem {
	const id = groupId(repository, kind, changelist)
	const changes = groupChanges(repository, kind, changelists, changelist)
	const children =
		viewMode === 'tree'
			? buildTree(repository, kind, changes).map(node => toEntry(node, id, viewMode, icons))
			: [...changes].sort(byPath).map(change => toFileItem(repository, id, change, viewMode, icons))

	return {
		id,
		kind,
		changelist,
		label: changelist ?? GROUP_LABELS[kind],
		description: changelist === undefined ? undefined : changelists.descriptions?.[changelist],
		count: changes.length,
		active: kind === 'changes' && changelist === changelists.active,
		children,
	}
}

/** A group's or changelist's row id, which its folders' and files' ids start with. */
function groupId(repository: Repository, kind: GroupKind, changelist: string | undefined): string {
	return changelist === undefined ? `${repository.rootUri}#${kind}` : `${repository.rootUri}#changelist#${changelist}`
}

/** A folder's or file's row in tree mode, with the rows below a folder. */
function toEntry(
	node: FolderNode | ResourceNode,
	parentId: string,
	viewMode: ViewMode,
	icons: IconResolver,
): FolderItem | FileItem {
	if (node.type === 'resource') {
		return toFileItem(node.repository, parentId, node.change, viewMode, icons)
	}

	return {
		type: 'folder',
		id: `${parentId}#${node.uri}`,
		uri: node.uri.toString(),
		label: node.label,
		icon: icons.folder(node.uri, false),
		expandedIcon: icons.folder(node.uri, true),
		children: node.children.map(child => toEntry(child, parentId, viewMode, icons)),
	}
}

/** A file's row: its name, icon and status, and its folder in list mode. */
function toFileItem(
	repository: Repository,
	parentId: string,
	change: Change,
	viewMode: ViewMode,
	icons: IconResolver,
): FileItem {
	const decoration = STATUS_DECORATIONS[change.status]
	const relativePath = path.relative(repository.rootUri.fsPath, change.uri.fsPath)
	const folder = path.dirname(relativePath)

	return {
		type: 'file',
		id: `${parentId}#${change.uri}`,
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
