// A repository's changes, by group, and how many files of each kind it has changed.
import { Status } from '../constants/git.ts'
import type { Change, Repository } from '../types/git.ts'
import type { ChangeCategory, ChangeCounts, GroupKind } from '../types/shared.ts'

// The groups in the order the view shows them, with the built-in Source Control view's names.
export const GROUP_LABELS: Record<GroupKind, string> = {
	merge: 'Merge Changes',
	staged: 'Staged Changes',
	changes: 'Changes',
	untracked: 'Untracked Changes',
}

// Ignored files are never shown, so they have no category.
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

// A file in two groups counts once, under the first of its categories in this list.
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

/** Whether the repository has any changes, so the view shows it. */
export function hasChanges(repository: Repository): boolean {
	return allChanges(repository).length > 0
}

/** The URIs of every file with changes, staged or not. */
export function changedUris(repository: Repository): Set<string> {
	return new Set(allChanges(repository).map(change => change.uri.toString()))
}

/** How many files are added, modified, deleted and in conflict, each file counted once. */
export function countChanges(repository: Repository): ChangeCounts {
	const counts: ChangeCounts = { added: 0, modified: 0, deleted: 0, conflict: 0 }

	for (const category of fileCategories(repository).values()) {
		counts[category]++
	}

	return counts
}

/** Every group's changes, in the order the view shows the groups. */
function allChanges(repository: Repository): Change[] {
	return (Object.keys(GROUP_LABELS) as GroupKind[]).flatMap(kind => getChanges(repository, kind))
}

/** Each changed file's category, by its URI. */
function fileCategories(repository: Repository): Map<string, ChangeCategory> {
	const categories = new Map<string, ChangeCategory>()

	for (const change of allChanges(repository)) {
		const uri = change.uri.toString()
		const category = STATUS_CATEGORIES[change.status]
		const current = categories.get(uri)

		if (category && (!current || CATEGORY_PRIORITY.indexOf(category) < CATEGORY_PRIORITY.indexOf(current))) {
			categories.set(uri, category)
		}
	}

	return categories
}
