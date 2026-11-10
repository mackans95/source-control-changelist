// Which changelist each change is in, and keeping a repository's saved lists up to date.
import { changedUris, getChanges } from './changes.ts'
import type { Change, Repository } from '../types/git.ts'
import type { RepositoryChangelists } from '../types/extension.ts'
import type { GroupKind } from '../types/shared.ts'

// The groups a repository's Stage All and Commit take the changes from, outside the changelists.
const UNSTAGED_KINDS: readonly GroupKind[] = ['merge', 'changes', 'untracked']

/** The changelist a change is in, or undefined for Changes or Untracked Changes. */
export function changelistOf(changelists: RepositoryChangelists, change: Change): string | undefined {
	const name = changelists.files[change.uri.toString()]
	return name !== undefined && changelists.lists.includes(name) ? name : undefined
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
		return [...getChanges(repository, 'changes'), ...getChanges(repository, 'untracked')].filter(
			change => changelistOf(changelists, change) === changelist,
		)
	}

	if (kind === 'changes' || kind === 'untracked') {
		return getChanges(repository, kind).filter(change => changelistOf(changelists, change) === undefined)
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

	return { ...changelists, files: Object.fromEntries(files) }
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
