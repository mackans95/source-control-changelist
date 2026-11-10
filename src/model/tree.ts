// A group's changes as a folder tree, for tree mode.
import * as path from 'path'
import type { Change, Repository } from '../types/git.ts'
import type { Directory, FolderNode, ResourceNode } from '../types/extension.ts'
import type { GroupKind } from '../types/shared.ts'

/** A group's changes in their folders, with folders that only hold one folder joined, like `src/app`. */
export function buildTree(
	repository: Repository,
	kind: GroupKind,
	changes: readonly Change[],
): (FolderNode | ResourceNode)[] {
	// URIs' paths use `/` on every platform, so the folders' URIs can be made from the repository's.
	const rootPath = repository.rootUri.path

	return toNodes(repository, kind, sortIntoFolders(rootPath, changes), rootPath)
}

/** Sorts changes by their path, for list mode and for the files in a folder. */
export function byPath(a: Change, b: Change): number {
	return a.uri.fsPath.localeCompare(b.uri.fsPath)
}

/** The changes sorted into nested folders, by their path below `rootPath`. */
function sortIntoFolders(rootPath: string, changes: readonly Change[]): Directory {
	const root: Directory = { directories: new Map(), files: [] }

	for (const change of changes) {
		const folderNames = path.posix.relative(rootPath, change.uri.path).split('/').slice(0, -1)
		let directory = root

		for (const name of folderNames) {
			directory = subfolder(directory, name)
		}

		directory.files.push(change)
	}

	return root
}

/** A folder's subfolder, made if it isn't there yet. */
function subfolder(directory: Directory, name: string): Directory {
	let child = directory.directories.get(name)

	if (!child) {
		child = { directories: new Map(), files: [] }
		directory.directories.set(name, child)
	}

	return child
}

/** A folder's rows: its folders and then its files, each sorted by name. */
function toNodes(
	repository: Repository,
	kind: GroupKind,
	directory: Directory,
	directoryPath: string,
): (FolderNode | ResourceNode)[] {
	const folders = [...directory.directories]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, child]) => toFolderNode(repository, kind, name, child, directoryPath))
	const files = [...directory.files]
		.sort(byPath)
		.map((change): ResourceNode => ({ type: 'resource', repository, kind, change }))

	return [...folders, ...files]
}

/** A folder's row, joined with the folders below it while each one only holds one folder. */
function toFolderNode(
	repository: Repository,
	kind: GroupKind,
	name: string,
	directory: Directory,
	parentPath: string,
): FolderNode {
	let label = name
	let folderPath = path.posix.join(parentPath, name)
	let current = directory

	while (current.files.length === 0 && current.directories.size === 1) {
		const [[nextName, next]] = current.directories
		label = `${label}/${nextName}`
		folderPath = path.posix.join(folderPath, nextName)
		current = next
	}

	const children = toNodes(repository, kind, current, folderPath)

	return {
		type: 'folder',
		repository,
		kind,
		uri: repository.rootUri.with({ path: folderPath }),
		label,
		changes: children.flatMap(node => (node.type === 'folder' ? node.changes : [node.change])),
		children,
	}
}
