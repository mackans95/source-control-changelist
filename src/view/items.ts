// The rows' data: each repository's state turned into the plain data the webview draws.
import * as path from 'path'
import { Status } from '../constants/git.ts'
import { STATUS_DECORATIONS } from '../constants/statusDecorations.ts'
import { themeColor } from '../helpers/shared.ts'
import { GROUP_LABELS, countChanges, hasChanges } from '../model/changes.ts'
import { groupChanges, listsOf, splitStaged } from '../model/changelists.ts'
import { mainRepository, mainRepositoryPath, repositoryName } from '../model/repositories.ts'
import { needsSync, syncState } from '../model/sync.ts'
import { buildTree, byPath } from '../model/tree.ts'
import type {
	FileDetails,
	FileDiff,
	FolderNode,
	IconResolver,
	RepositoryChangelists,
	ResourceNode,
	ViewMode,
} from '../types/extension.ts'
import type { Change, Repository } from '../types/git.ts'
import type {
	FileItem,
	FolderItem,
	GroupItem,
	GroupKind,
	RepositoryItem,
	RepositoryKind,
	SyncRepositoryItem,
	StagedState,
} from '../types/shared.ts'

// The statuses of the changes in Staged Changes.
const STAGED_STATUSES: ReadonlySet<number> = new Set([
	Status.INDEX_MODIFIED,
	Status.INDEX_ADDED,
	Status.INDEX_DELETED,
	Status.INDEX_RENAMED,
	Status.INDEX_COPIED,
])

/** A repository's row with its groups that have changes, and all its changelists after Changes. */
export function toRepositoryItem(
	repository: Repository,
	changelists: RepositoryChangelists,
	viewMode: ViewMode,
	icons: IconResolver,
	diffOf: (change: Change) => FileDiff | undefined = () => undefined,
): RepositoryItem {
	const group = (kind: GroupKind, changelist?: string) =>
		toGroupItem(repository, changelists, kind, changelist, viewMode, icons, diffOf)

	const groups = (kinds: GroupKind[]) =>
		kinds
			.filter(kind => groupChanges(repository, kind, changelists, undefined, diffOf).length > 0)
			.map(kind => group(kind))

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
			...changelists.lists.map(name => group('changes', name)),
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
	diffOf: (change: Change) => FileDiff | undefined = () => undefined,
): GroupItem {
	const id = groupId(repository, kind, changelist)
	const changes = groupChanges(repository, kind, changelists, changelist, diffOf)
	const head = repository.state.HEAD?.commit
	const staged = new Set(repository.state.indexChanges.map(change => change.uri.toString()))
	// How much of a file's changes in a list is staged: of its part in the list when it's split.
	const stagedIn = (change: Change, list: string | undefined) =>
		splitStaged(changelists, change, diffOf(change), head, list) ?? stagedState(change, staged)
	// The other groups a file's row is in. Changes, which is Git's, only has a part that isn't all staged.
	const showsIn = (change: Change, list: string | undefined) =>
		list !== undefined || (!STAGED_STATUSES.has(change.status) && stagedIn(change, undefined) !== 'all')
	// Staged Changes and Merge Changes are Git's own, so their rows don't say which lists a file is in.
	const listsShown = kind === 'changes' || kind === 'untracked'
	const details = (change: Change): FileDetails => ({
		otherLists: listsOf(changelists, change)
			.filter(list => listsShown && list !== changelist && showsIn(change, list))
			.map(list => list ?? GROUP_LABELS.changes),
		staged: changelist === undefined ? 'none' : stagedIn(change, changelist),
	})

	const children =
		viewMode === 'tree'
			? buildTree(repository, kind, changes).map(node => toEntry(node, id, viewMode, icons, details))
			: [...changes]
					.sort(byPath)
					.map(change => toFileItem(repository, id, change, viewMode, icons, details(change)))

	return {
		id,
		kind,
		changelist,
		label: changelist ?? GROUP_LABELS[kind],
		description: changelist === undefined ? undefined : changelists.descriptions?.[changelist],
		count: changes.length,
		active: kind === 'changes' && changelist === changelists.active,
		staged: combineStaged(children.map(child => child.staged)),
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
	details: (change: Change) => FileDetails,
): FolderItem | FileItem {
	if (node.type === 'resource') {
		return toFileItem(node.repository, parentId, node.change, viewMode, icons, details(node.change))
	}

	const children = node.children.map(child => toEntry(child, parentId, viewMode, icons, details))

	return {
		type: 'folder',
		id: `${parentId}#${node.uri}`,
		uri: node.uri.toString(),
		label: node.label,
		icon: icons.folder(node.uri, false),
		expandedIcon: icons.folder(node.uri, true),
		staged: combineStaged(children.map(child => child.staged)),
		children,
	}
}

/** A file's row: its name, icon and status, its folder in list mode, and its details. */
function toFileItem(
	repository: Repository,
	parentId: string,
	change: Change,
	viewMode: ViewMode,
	icons: IconResolver,
	{ otherLists, staged }: FileDetails,
): FileItem {
	const decoration = STATUS_DECORATIONS[change.status]
	const relativePath = path.relative(repository.rootUri.fsPath, change.uri.fsPath)
	const folder = path.dirname(relativePath)
	const split = otherLists.length > 0 ? ` • Also has changes in ${otherLists.join(', ')}` : ''
	const stagedText = staged === 'none' ? '' : staged === 'all' ? ' • Staged' : ' • Partly staged'

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
		tooltip: `${relativePath} • ${decoration.text}${split}${stagedText}`,
		otherLists,
		staged,
	}
}

/** How much of a change is staged: all of it for a change from Staged Changes, or some when it's staged too. */
function stagedState(change: Change, staged: ReadonlySet<string>): StagedState {
	if (STAGED_STATUSES.has(change.status)) return 'all'

	return staged.has(change.uri.toString()) ? 'some' : 'none'
}

function combineStaged(states: readonly StagedState[]): StagedState {
	if (states.length > 0 && states.every(state => state === 'all')) return 'all'

	return states.some(state => state !== 'none') ? 'some' : 'none'
}
