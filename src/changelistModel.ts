// What the view shows of a repository, worked out from the Git extension's state. It doesn't use
// `vscode`, so the tests can run it in Node, and its own imports have their `.ts` for that.
import * as path from 'path'
import { Status } from './constants/index.ts'
import type { Change, Repository } from './types/git.ts'
import type { ChangeCategory, ChangeCounts, GroupKind } from './types/shared.ts'
import type { FolderNode, ResourceNode } from './types/view.ts'

export const GROUP_LABELS: Record<GroupKind, string> = {
	merge: 'Merge Changes',
	staged: 'Staged Changes',
	changes: 'Changes',
	untracked: 'Untracked Changes',
}

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

export function hasChanges(repository: Repository): boolean {
	return (Object.keys(GROUP_LABELS) as GroupKind[]).some(kind => getChanges(repository, kind).length > 0)
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

export function repositoryName(repository: Repository): string {
	return path.basename(repository.rootUri.fsPath)
}

export function byPath(a: Change, b: Change): number {
	return a.uri.fsPath.localeCompare(b.uri.fsPath)
}

interface Directory {
	readonly directories: Map<string, Directory>
	readonly files: Change[]
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
