// Repositories' names, the repository a worktree belongs to, and the order the view lists them in.
import * as path from 'path'
import type { Repository } from '../types/git.ts'

/**
 * Repositories in the order the user dragged them into, or else in the workspace's folder order and
 * by name. Each worktree comes right after its repository.
 */
export function sortRepositories(
	repositories: readonly Repository[],
	folders: readonly string[] = [],
	order: readonly string[] = [],
): Repository[] {
	const mainOf = (repository: Repository) => mainRepository(repository, repositories)
	const byFolder = (a: Repository, b: Repository) => folderIndex(a, folders) - folderIndex(b, folders) || byName(a, b)
	const worktreesOf = (main: Repository) => repositories.filter(r => mainOf(r) === main).sort(byName)

	// A worktree whose repository isn't open is sorted like any other repository.
	const mains = applyOrder(repositories.filter(r => !mainOf(r)).sort(byFolder), order)

	return mains.flatMap(main => [main, ...worktreesOf(main)])
}

/** An order of root URIs with `uri` moved right before or after `target`. */
export function moveInOrder(order: readonly string[], uri: string, target: string, after: boolean): string[] {
	const rest = order.filter(o => o !== uri)
	const index = rest.indexOf(target)

	if (uri === target || index === -1) return [...order]

	rest.splice(after ? index + 1 : index, 0, uri)

	return rest
}

/** The repository's folder name, which the view shows as its name. */
export function repositoryName(repository: Repository): string {
	return path.basename(repository.rootUri.fsPath)
}

/** Sorts repositories by their name. */
export function byName(a: Repository, b: Repository): number {
	return repositoryName(a).localeCompare(repositoryName(b))
}

/** For a worktree, the repository it belongs to, when that one is open too. */
export function mainRepository(repository: Repository, repositories: readonly Repository[]): Repository | undefined {
	const mainPath = mainRepositoryPath(repository)
	return mainPath === undefined ? undefined : repositories.find(r => r.rootUri.fsPath === mainPath)
}

/** For a worktree, the folder of the repository it belongs to. */
export function mainRepositoryPath(repository: Repository): string | undefined {
	if (repository.kind !== 'worktree') return undefined

	// Older versions of the Git extension don't list worktrees.
	return repository.state.worktrees?.find(w => w.main)?.path
}

/** The index of the workspace folder the repository is in, or that's inside it, or else after them all. */
export function folderIndex(repository: Repository, folders: readonly string[]): number {
	const root = repository.rootUri.fsPath
	const index = folders.findIndex(folder => isInside(root, folder) || isInside(folder, root))

	return index === -1 ? folders.length : index
}

/** Sorted repositories put in a saved order of root URIs. */
export function applyOrder(sorted: readonly Repository[], order: readonly string[]): Repository[] {
	const ordered = order.flatMap(uri => sorted.filter(r => r.rootUri.toString() === uri))

	// One that isn't in the saved order, like a repository opened since, goes after the one before it in `sorted`.
	sorted.forEach((repo, i) => {
		if (ordered.includes(repo)) return
		const previous = sorted[i - 1]
		ordered.splice(previous ? ordered.indexOf(previous) + 1 : 0, 0, repo)
	})

	return ordered
}

/** Whether a path is a folder or inside it. */
function isInside(child: string, folder: string): boolean {
	return child === folder || child.startsWith(folder.endsWith(path.sep) ? folder : folder + path.sep)
}
