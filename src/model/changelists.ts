// Which changelists each change is in, and keeping a repository's saved lists up to date.
import { changedUris, getChanges } from './changes.ts'
import { assignHunks, splitHunks } from './hunks.ts'
import type { Change, Repository } from '#types/git.ts'
import type { Hunk, RepositoryChangelists } from '#types/extension.ts'
import type { GroupKind } from '#types/shared.ts'

// The groups a repository's Stage All and Commit take the changes from, outside the changelists.
const UNSTAGED_KINDS: readonly GroupKind[] = ['merge', 'changes', 'untracked']

/** The changelist a change is in, or undefined for Changes or Untracked Changes. */
export function changelistOf(changelists: RepositoryChangelists, change: Change): string | undefined {
	const name = changelists.files[change.uri.toString()]
	return name !== undefined && changelists.lists.includes(name) ? name : undefined
}

/** The lists a file has changes in: its own, and for a split file the lists of its other changes. */
export function listsOf(changelists: RepositoryChangelists, change: Change): (string | undefined)[] {
	const own = changelistOf(changelists, change)
	const saved = changelists.hunks?.[change.uri.toString()]?.hunks ?? []
	const others = saved.map(h => validList(changelists, h.list, own))

	return [...new Set([own, ...others])]
}

/** Which list each of a file's changes is in, without putting new ones in the active list. */
export function hunkLists(
	changelists: RepositoryChangelists,
	change: Change,
	hunks: readonly Hunk[],
	head: string,
): (string | undefined)[] {
	const fileList = changelistOf(changelists, change)
	const saved = changelists.hunks?.[change.uri.toString()]
	return assignHunks(hunks, saved, head, undefined, fileList, undefined).map(list =>
		validList(changelists, list, fileList),
	)
}

/** The changes a group or changelist shows. Merge and Staged Changes ignore the changelists. */
export function groupChanges(
	repository: Repository,
	kind: GroupKind,
	changelists: RepositoryChangelists,
	changelist?: string,
): readonly Change[] {
	if (changelist !== undefined) {
		// A changelist takes both changed and untracked files.
		return [...getChanges(repository, 'changes'), ...getChanges(repository, 'untracked')].filter(change =>
			listsOf(changelists, change).includes(changelist),
		)
	}

	if (kind === 'changes' || kind === 'untracked') {
		return getChanges(repository, kind).filter(change => listsOf(changelists, change).includes(undefined))
	}

	return getChanges(repository, kind)
}

/** The unstaged changes that aren't in a changelist, which a repository's Stage All and Commit take. */
export function unlistedChanges(repository: Repository, changelists: RepositoryChangelists): Change[] {
	return UNSTAGED_KINDS.flatMap(kind => groupChanges(repository, kind, changelists))
}

/** The changelists without the files that no longer have changes. */
export function pruneChangelists(repository: Repository, changelists: RepositoryChangelists): RepositoryChangelists {
	// A staged file still has changes, so it goes back to its list when it's unstaged.
	const changed = changedUris(repository)
	const files = Object.entries(changelists.files).filter(
		([uri, name]) => changed.has(uri) && changelists.lists.includes(name),
	)
	const hunks = Object.entries(changelists.hunks ?? {}).filter(([uri]) => changed.has(uri))

	return { ...changelists, files: Object.fromEntries(files), hunks: orUndefined(Object.fromEntries(hunks)) }
}

/** The changelists with the files in `changed` but not in `known` added to the active list. */
export function claimNewChanges(
	changelists: RepositoryChangelists,
	known: ReadonlySet<string>,
	changed: ReadonlySet<string>,
): RepositoryChangelists {
	const { active } = changelists

	if (active === undefined || !changelists.lists.includes(active)) {
		return changelists
	}

	// Files that are in a list already stay there.
	const claimed = [...changed].filter(uri => !known.has(uri) && changelists.files[uri] === undefined)

	if (claimed.length === 0) {
		return changelists
	}

	return {
		...changelists,
		files: {
			...changelists.files,
			...Object.fromEntries(claimed.map(uri => [uri, active])),
		},
	}
}

/** The changelists with each diffed file's changes in their lists. A file whose changes are all in one list moves there. */
export function trackHunks(
	changelists: RepositoryChangelists,
	diffs: ReadonlyMap<string, readonly Hunk[]>,
	previous: ReadonlyMap<string, readonly Hunk[]>,
	head: string,
): RepositoryChangelists {
	const files: Record<string, string> = { ...changelists.files }
	const active = validList(changelists, changelists.active)
	// Only the files that were read can still be split.
	const hunks = Object.fromEntries(Object.entries(changelists.hunks ?? {}).filter(([uri]) => diffs.has(uri)))

	for (const [uri, current] of diffs) {
		const fileList = validList(changelists, files[uri])
		const lists = assignHunks(current, hunks[uri], head, previous.get(uri), fileList, active).map(list =>
			validList(changelists, list, fileList),
		)
		// A file keeps its list while any of its changes are in it.
		const ownList = lists.length === 0 || lists.includes(fileList) ? fileList : lists[0]
		const split = splitHunks(current, lists, ownList, head)

		if (ownList === undefined) {
			delete files[uri]
		} else {
			files[uri] = ownList
		}

		if (split) {
			hunks[uri] = split
		} else {
			delete hunks[uri]
		}
	}

	return { ...changelists, files, hunks: orUndefined(hunks) }
}

/** A list if it still exists, or else `fallback`. Undefined, Changes, always exists. */
function validList(
	changelists: RepositoryChangelists,
	list: string | undefined,
	fallback?: string,
): string | undefined {
	return list === undefined || changelists.lists.includes(list) ? list : fallback
}

/** A record, or undefined when it's empty, so it isn't saved. */
function orUndefined<T>(record: Record<string, T>): Record<string, T> | undefined {
	return Object.keys(record).length > 0 ? record : undefined
}
