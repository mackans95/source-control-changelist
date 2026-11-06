// What the view shows of a repository, worked out from the Git extension's state. It doesn't use
// `vscode`, so the tests can run it in Node.
import * as path from 'path'
import { Status } from './constants/git.ts'
import type { Change, Repository } from './types/git.ts'
import type { ChangeCategory, ChangeCounts, GroupKind, SyncState } from './types/shared.ts'
import type { Directory, FolderNode, RepositoryChangelists, ResourceNode } from './types/extension.ts'

// The groups, in the order the view shows them, with the built-in Source Control view's names.
export const GROUP_LABELS: Record<GroupKind, string> = {
	merge: 'Merge Changes',
	staged: 'Staged Changes',
	changes: 'Changes',
	untracked: 'Untracked Changes',
}

// Ignored files never show up in the view, so they have no category.
const STATUS_CATEGORIES: Record<(typeof Status)[keyof typeof Status], ChangeCategory | undefined> = {
	[Status.INDEX_MODIFIED]: 'modified',
	[Status.INDEX_ADDED]: 'added',
	[Status.INDEX_DELETED]: 'deleted',
	[Status.INDEX_RENAMED]: 'modified',
	[Status.INDEX_COPIED]: 'added',
	[Status.MODIFIED]: 'modified',
	[Status.DELETED]: 'deleted',
	[Status.UNTRACKED]: 'added',
	[Status.IGNORED]: undefined,
	[Status.INTENT_TO_ADD]: 'added',
	[Status.INTENT_TO_RENAME]: 'modified',
	[Status.TYPE_CHANGED]: 'modified',
	[Status.ADDED_BY_US]: 'conflict',
	[Status.ADDED_BY_THEM]: 'conflict',
	[Status.DELETED_BY_US]: 'conflict',
	[Status.DELETED_BY_THEM]: 'conflict',
	[Status.BOTH_ADDED]: 'conflict',
	[Status.BOTH_DELETED]: 'conflict',
	[Status.BOTH_MODIFIED]: 'conflict',
}

// A file that's in more than one group, like staged and then edited again, counts once, under the first of these.
const CATEGORY_PRIORITY: readonly ChangeCategory[] = ['conflict', 'added', 'deleted', 'modified']

/** A group's changes, from the repository's current state. */
export function getChanges(repository: Repository, kind: GroupKind): readonly Change[] {
	const state = repository.state
	switch (kind) {
		case 'merge':
			return state.mergeChanges
		case 'staged':
			return state.indexChanges
		case 'changes':
			return state.workingTreeChanges
		case 'untracked':
			return state.untrackedChanges
	}
}

/** Which changelist a change is in, or undefined for none: the default Changes list, or Untracked Changes. */
export function changelistOf(changelists: RepositoryChangelists, change: Change): string | undefined {
	const name = changelists.files[change.uri.toString()]
	return name !== undefined && changelists.lists.includes(name) ? name : undefined
}

/**
 * A group's or changelist's changes. A changelist has the changes and untracked files moved to it,
 * and Changes and Untracked Changes have the rest. Merge and Staged Changes are Git's own, so
 * changelists don't change them.
 */
export function groupChanges(
	repository: Repository,
	kind: GroupKind,
	changelists: RepositoryChangelists,
	changelist?: string,
): readonly Change[] {
	if (changelist !== undefined) {
		return [...getChanges(repository, 'changes'), ...getChanges(repository, 'untracked')].filter(
			change => changelistOf(changelists, change) === changelist,
		)
	}

	if (kind === 'changes' || kind === 'untracked') {
		return getChanges(repository, kind).filter(change => changelistOf(changelists, change) === undefined)
	}

	return getChanges(repository, kind)
}

/**
 * The changelists without the files that have no changes any more, because they were committed or
 * discarded. A file that's only staged keeps its list, so it goes back there when it's unstaged.
 */
export function pruneChangelists(repository: Repository, changelists: RepositoryChangelists): RepositoryChangelists {
	const changed = new Set(
		(Object.keys(GROUP_LABELS) as GroupKind[])
			.flatMap(kind => getChanges(repository, kind))
			.map(c => c.uri.toString()),
	)
	const files = Object.entries(changelists.files).filter(
		([uri, name]) => changed.has(uri) && changelists.lists.includes(name),
	)

	return { lists: changelists.lists, files: Object.fromEntries(files) }
}

/** Whether the repository has any changes, so the view shows it. */
export function hasChanges(repository: Repository): boolean {
	return (Object.keys(GROUP_LABELS) as GroupKind[]).some(kind => getChanges(repository, kind).length > 0)
}

/** Where the repository's branch stands against its upstream, as far as Git knows since its last fetch. */
export function syncState(repository: Repository): SyncState {
	const head = repository.state.HEAD
	const hasName = head?.name
	const hasUpstream = head?.upstream
	const isAhead = (head?.ahead ?? 0) > 0
	const isBehind = (head?.behind ?? 0) > 0

	switch (true) {
		case !hasName:
			return 'detached'
		case !hasUpstream:
			return 'unpublished'
		case isAhead && isBehind:
			return 'diverged'
		case isAhead:
			return 'ahead'
		case isBehind:
			return 'behind'
		default:
			return 'synced'
	}
}

/** Whether the repository has commits to push or pull. A branch that isn't published doesn't count. */
export function needsSync(repository: Repository): boolean {
	const state = syncState(repository)

	return state === 'ahead' || state === 'behind' || state === 'diverged'
}

/** Whether the repository has commits to pull, so Pull All pulls it. A diverged branch counts too. */
export function needsPull(repository: Repository): boolean {
	const state = syncState(repository)

	return state === 'behind' || state === 'diverged'
}

/**
 * The part of a failed Git command's error worth showing: its `fatal:` or `error:` line, or else its
 * last line. Git's hints before it explain the options, which a tooltip has no room for.
 */
export function gitErrorMessage(error: unknown): string {
	const stderr = (error as { stderr?: unknown } | undefined)?.stderr
	const lines =
		typeof stderr === 'string'
			? stderr
					.split('\n')
					.map(line => line.trim())
					.filter(Boolean)
			: []
	const reason = lines.find(line => /^(fatal|error): /.test(line) ?? lines.at(-1))

	if (reason) {
		return reason.replace(/^(fatal|error): /, '')
	}

	return error instanceof Error ? error.message : String(error)
}

/** How many files are added, modified, deleted and in conflict, each file counted once. */
export function countChanges(repository: Repository): ChangeCounts {
	const categories = new Map<string, ChangeCategory>()

	for (const kind of Object.keys(GROUP_LABELS) as GroupKind[]) {
		for (const change of getChanges(repository, kind)) {
			const category = STATUS_CATEGORIES[change.status]
			const current = categories.get(change.uri.toString())

			if (category && (!current || CATEGORY_PRIORITY.indexOf(category) < CATEGORY_PRIORITY.indexOf(current))) {
				categories.set(change.uri.toString(), category)
			}
		}
	}

	const counts: ChangeCounts = { added: 0, modified: 0, deleted: 0, conflict: 0 }

	for (const category of categories.values()) {
		counts[category]++
	}

	return counts
}

/** The repository's folder name, which the view shows as its name. */
export function repositoryName(repository: Repository): string {
	return path.basename(repository.rootUri.fsPath)
}

/** Sorts repositories by their name. */
export function byName(a: Repository, b: Repository): number {
	return repositoryName(a).localeCompare(repositoryName(b))
}

/** For a worktree, the folder of the repository it belongs to. */
export function mainRepositoryPath(repository: Repository): string | undefined {
	if (repository.kind !== 'worktree') return undefined

	// Older versions of the Git extension don't list worktrees.
	return repository.state.worktrees?.find(w => w.main)?.path
}

/** For a worktree, the repository it belongs to, when that one is open too. */
export function mainRepository(repository: Repository, repositories: readonly Repository[]): Repository | undefined {
	const mainPath = mainRepositoryPath(repository)
	return mainPath === undefined ? undefined : repositories.find(r => r.rootUri.fsPath === mainPath)
}

/**
 * Sorts repositories by their name, for the view and the Repositories panel, with each worktree
 * right after the repository it belongs to. A worktree whose repository isn't open is sorted by its
 * own name.
 */
export function sortRepositories(repositories: readonly Repository[]): Repository[] {
	const mainOf = (repository: Repository) => mainRepository(repository, repositories)
	const worktrees = repositories.filter(mainOf)

	return repositories
		.filter(r => !mainOf(r))
		.sort(byName)
		.flatMap(main => [main, ...worktrees.filter(w => mainOf(w) === main).sort(byName)])
}

/** Sorts changes by their path, for list mode and for the files in a folder. */
export function byPath(a: Change, b: Change): number {
	return a.uri.fsPath.localeCompare(b.uri.fsPath)
}

/**
 * Builds the folder hierarchy for a group, compacting single-folder chains like `src/app`. It works
 * with the URIs' paths, which use `/` on every platform, so the folders' URIs can come from the
 * repository's.
 */
export function buildTree(
	repository: Repository,
	kind: GroupKind,
	changes: readonly Change[],
): (FolderNode | ResourceNode)[] {
	const rootPath = repository.rootUri.path
	const root: Directory = { directories: new Map(), files: [] }

	for (const change of changes) {
		const segments = path.posix.relative(rootPath, change.uri.path).split('/')
		let directory = root
		for (const segment of segments.slice(0, -1)) {
			let child = directory.directories.get(segment)
			if (!child) {
				child = { directories: new Map(), files: [] }
				directory.directories.set(segment, child)
			}
			directory = child
		}
		directory.files.push(change)
	}

	const toNodes = (directory: Directory, directoryPath: string): (FolderNode | ResourceNode)[] => {
		const folders = [...directory.directories]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, child]): FolderNode => {
				let label = name
				let folderPath = path.posix.join(directoryPath, name)
				while (child.files.length === 0 && child.directories.size === 1) {
					const [[nextName, next]] = child.directories
					label = `${label}/${nextName}`
					folderPath = path.posix.join(folderPath, nextName)
					child = next
				}
				const children = toNodes(child, folderPath)
				const folderChanges = children.flatMap(n => (n.type === 'folder' ? n.changes : [n.change]))
				return {
					type: 'folder',
					repository,
					kind,
					uri: repository.rootUri.with({ path: folderPath }),
					label,
					changes: folderChanges,
					children,
				}
			})
		const files = [...directory.files]
			.sort(byPath)
			.map((change): ResourceNode => ({ type: 'resource', repository, kind, change }))
		return [...folders, ...files]
	}

	return toNodes(root, rootPath)
}
