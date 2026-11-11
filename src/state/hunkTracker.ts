// Each modified file's changes, read with `git diff -U0` after each of Git's status checks, which keep
// a split file's changes in their lists.
import * as path from 'path'
import * as vscode from 'vscode'
import { Status } from '#constants/git.ts'
import { runGit } from '#helpers/git.ts'
import { trackHunks } from '#model/changelists.ts'
import { parseDiff } from '#model/hunks.ts'
import type { ChangelistStore } from '#state/changelistStore.ts'
import type { Hunk } from '#types/extension.ts'
import type { Change, Repository } from '#types/git.ts'

/** Every modified file's changes at Git's last check, and which list each one is in. */
export class HunkTracker implements vscode.Disposable {
	// The git the Git extension uses.
	private readonly gitPath: string
	private readonly changelists: ChangelistStore
	// Each repository's modified files' changes at the last check, by root URI and then file URI.
	private readonly hunks = new Map<string, ReadonlyMap<string, readonly Hunk[]>>()
	// The checks that are running, by root URI, and the repositories that need one more after them.
	private readonly running = new Map<string, Promise<void>>()
	private readonly again = new Set<string>()
	private readonly changeEmitter = new vscode.EventEmitter<void>()

	// When the changes have been read again.
	readonly onDidChange = this.changeEmitter.event

	constructor(gitPath: string, changelists: ChangelistStore) {
		this.gitPath = gitPath
		this.changelists = changelists
	}

	/** A modified file's changes at the last check, or undefined when it wasn't read. */
	get(repository: Repository, uri: vscode.Uri): readonly Hunk[] | undefined {
		return this.hunks.get(repository.rootUri.toString())?.get(uri.toString())
	}

	/** Reads a repository's changes again, after the check that's running, if any, and resolves once they're read. */
	track(repository: Repository): Promise<void> {
		const key = repository.rootUri.toString()
		const running = this.running.get(key)

		// One check at a time, and one more for everything that came in meanwhile.
		if (running) {
			this.again.add(key)
			return running
		}

		const checks = (async () => {
			try {
				do {
					this.again.delete(key)
					await this.check(repository)
				} while (this.again.has(key))
			} finally {
				this.running.delete(key)
			}
		})()

		this.running.set(key, checks)
		return checks
	}

	/** Stops the change event. */
	dispose(): void {
		this.changeEmitter.dispose()
	}

	/** Reads the changes, and puts each one in its list. */
	private async check(repository: Repository): Promise<void> {
		const key = repository.rootUri.toString()
		const head = repository.state.HEAD?.commit

		// Read also without lists, so a change made right after the first list is made is known to be new.
		if (!head || !partialChangelists()) {
			this.hunks.delete(key)
			await this.changelists.update(repository, changelists => ({ ...changelists, hunks: undefined }))
			return
		}

		const previous = this.hunks.get(key) ?? new Map<string, readonly Hunk[]>()
		let diffs: Map<string, readonly Hunk[]>

		try {
			diffs = await this.diff(repository, modifiedChanges(repository))
		} catch {
			// Like while Git has the repository locked. The next check reads them again.
			return
		}

		this.hunks.set(key, diffs)
		await this.changelists.update(repository, changelists => trackHunks(changelists, diffs, previous, head))
		this.changeEmitter.fire()
	}

	/** Each file's changes against HEAD, by the file's URI. */
	private async diff(repository: Repository, changes: readonly Change[]): Promise<Map<string, readonly Hunk[]>> {
		if (changes.length === 0) return new Map()

		const root = repository.rootUri
		const paths = changes.map(change => path.posix.relative(root.path, change.uri.path))
		const args = ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames']
		const output = await runGit(this.gitPath, root.fsPath, [...args, 'HEAD', '--', ...paths])

		return new Map(
			[...parseDiff(output)].map(([file, hunks]) => [
				root.with({ path: path.posix.join(root.path, file) }).toString(),
				hunks,
			]),
		)
	}
}

/** The `changelist.partialChangelists` setting: whether a file's changes can be in different lists. */
function partialChangelists(): boolean {
	return vscode.workspace.getConfiguration('changelist').get<boolean>('partialChangelists', true)
}

/** The changes that can be split: modified files Git tracks, staged or not, without conflicts. */
function modifiedChanges(repository: Repository): Change[] {
	const { workingTreeChanges, indexChanges, mergeChanges } = repository.state
	const conflicts = new Set(mergeChanges.map(change => change.uri.toString()))
	const modified = [
		...workingTreeChanges.filter(change => change.status === Status.MODIFIED),
		...indexChanges.filter(change => change.status === Status.INDEX_MODIFIED),
	].filter(change => !conflicts.has(change.uri.toString()))

	// A file that's both staged and changed again is in both groups.
	return [...new Map(modified.map(change => [change.uri.toString(), change])).values()]
}
