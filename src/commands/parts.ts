// Staging and discarding a list's part of files: whole files as the Git API does it, and for a file
// split between lists only its changes in that list, with `git apply`.
import * as path from 'path'
import { paths } from './nodes.ts'
import { runGit } from '#helpers/git.ts'
import { hunkLists } from '#model/changelists.ts'
import {
	discardPatch,
	hunksInLines,
	hunksInside,
	hunksOutside,
	parseDiff,
	stagePatch,
	workingTreeLines,
} from '#model/hunks.ts'
import type { FilePart, FileParts, Services } from '#types/extension.ts'
import type { Change, Repository } from '#types/git.ts'

// `git diff` with one hunk per block of changed lines, and paths as they are.
const DIFF = ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff']

/** The changes as whole files, and for each split file its changes in `list`. Undefined is Changes. */
export async function partsOf(
	{ changelists, hunks }: Services,
	repository: Repository,
	changes: readonly Change[],
	list: string | undefined,
): Promise<FileParts> {
	// The changes as they are now, so the right ones are staged or discarded.
	await hunks.track(repository)

	const head = repository.state.HEAD?.commit
	const current = changelists.get(repository)
	const whole: Change[] = []
	const split: FilePart[] = []

	for (const change of changes) {
		const fileHunks = hunks.get(repository, change.uri)

		if (!head || !fileHunks || !current.hunks?.[change.uri.toString()]) {
			whole.push(change)
		} else {
			const lists = hunkLists(current, change, fileHunks, head)
			const part = fileHunks.filter((_, i) => lists[i] === list)

			if (part.length > 0) {
				split.push({ change, hunks: part })
			}
		}
	}

	return { whole, split }
}

/** Stages whole files, and the split files' parts on top of what's staged of them already. */
export async function stageParts(
	services: Services,
	repository: Repository,
	{ whole, split }: FileParts,
): Promise<void> {
	// The Git API's add with no paths would stage everything.
	if (whole.length > 0) {
		await repository.add(paths(whole))
	}

	for (const part of split) {
		await stagePart(services, repository, part)
	}

	await repository.status()
}

/** Discards whole files' changes, and the split files' parts from the working tree. */
export async function discardParts(
	{ git }: Services,
	repository: Repository,
	{ whole, split }: FileParts,
): Promise<void> {
	if (whole.length > 0) {
		await repository.clean(paths(whole))
	}

	for (const { change, hunks } of split) {
		const patch = discardPatch(relativePath(repository, change), hunks)
		await runGit(git.git.path, repository.rootUri.fsPath, ['apply', '-R', '--unidiff-zero', '-'], patch)
	}

	await repository.status()
}

/** Unstages whole files, and what's staged of the split files' parts. */
export async function unstageParts(
	{ git }: Services,
	repository: Repository,
	{ whole, split }: FileParts,
): Promise<void> {
	if (whole.length > 0) {
		await repository.revert(paths(whole))
	}

	for (const { change, hunks } of split) {
		const file = relativePath(repository, change)
		const root = repository.rootUri.fsPath
		const staged = parseDiff(await runGit(git.git.path, root, [...DIFF, '--cached', '--', file])).get(file) ?? []
		const unstaging = hunksInside(staged, hunks)

		if (unstaging.length > 0) {
			// The staged hunks as they are in the index, taken out of it.
			const patch = discardPatch(file, unstaging)
			await runGit(git.git.path, root, ['apply', '--cached', '-R', '--unidiff-zero', '-'], patch)
		}
	}

	await repository.status()
}

/** The split files that have changes staged that aren't their part's, like another list's. */
export async function stagedOutside(
	{ git }: Services,
	repository: Repository,
	split: readonly FilePart[],
): Promise<Change[]> {
	const staged = new Set(repository.state.indexChanges.map(change => change.uri.toString()))
	const outside: Change[] = []

	for (const { change, hunks } of split.filter(part => staged.has(part.change.uri.toString()))) {
		const file = relativePath(repository, change)
		const args = [...DIFF, '--cached', '--', file]
		const stagedHunks = parseDiff(await runGit(git.git.path, repository.rootUri.fsPath, args)).get(file) ?? []

		if (hunksOutside(stagedHunks, hunks).length > 0) {
			outside.push(change)
		}
	}

	return outside
}

/** Stages a split file's part. */
async function stagePart({ git }: Services, repository: Repository, { change, hunks }: FilePart): Promise<void> {
	const file = relativePath(repository, change)
	const root = repository.rootUri.fsPath
	const args = [...DIFF, '--', file]

	// Against what's staged of the file, which can differ from HEAD. The working tree's lines are the
	// same in both, so the part's changes are found by them.
	const unstaged = parseDiff(await runGit(git.git.path, root, args)).get(file) ?? []
	const staging = [...new Set(hunks.flatMap(hunk => hunksInLines(unstaged, ...workingTreeLines(hunk))))]

	if (staging.length > 0) {
		await runGit(git.git.path, root, ['apply', '--cached', '--unidiff-zero', '-'], stagePatch(file, staging))
	}
}

/** A file's path in its repository, as Git's patches have it. */
function relativePath(repository: Repository, change: Change): string {
	return path.posix.relative(repository.rootUri.path, change.uri.path)
}
