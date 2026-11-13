// Each modified file's changes, read with `git diff -U0` after each of Git's status checks, which keep
// a split file's changes in their lists.
import * as path from 'path'
import * as vscode from 'vscode'
import { Status } from '#constants/git.ts'
import { runGit } from '#helpers/git.ts'
import { trackHunks } from '#model/changelists.ts'
import { parseDiff } from '#model/hunks.ts'
import type { ChangelistStore } from '#state/changelistStore.ts'
import type { FileDiff, Hunk } from '#types/extension.ts'
import type { Change, Repository } from '#types/git.ts'

/** Every modified file's changes at Git's last check, and which list each one is in. */
export class HunkTracker implements vscode.Disposable {
	// The git the Git extension uses.
	private readonly gitPath: string
	private readonly changelists: ChangelistStore
	// Each repository's modified files' changes at the last check, by root URI and then file URI.
	private readonly diffs = new Map<string, ReadonlyMap<string, FileDiff>>()
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
		return this.diff(repository, uri)?.hunks
	}

	/** A modified file's changes at the last check, with which are staged, or undefined when it wasn't read. */
	diff(repository: Repository, uri: vscode.Uri): FileDiff | undefined {
		return this.diffs.get(repository.rootUri.toString())?.get(uri.toString())
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
			this.diffs.delete(key)
			await this.changelists.update(repository, changelists => ({ ...changelists, hunks: undefined }))
			return
		}

		const previous = new Map([...(this.diffs.get(key) ?? [])].map(([uri, diff]) => [uri, diff.hunks]))
		let diffs: Map<string, FileDiff>

		try {
			diffs = await this.read(repository)
		} catch {
			// Like while Git has the repository locked. The next check reads them again.
			return
		}

		this.diffs.set(key, diffs)
		const hunks = new Map([...diffs].map(([uri, diff]) => [uri, diff.hunks]))
		await this.changelists.update(repository, changelists => trackHunks(changelists, hunks, previous, head))
		this.changeEmitter.fire()
	}

	/** Each modified file's changes against HEAD, and for a file with staged changes which they are. */
	private async read(repository: Repository): Promise<Map<string, FileDiff>> {
		const changes = modifiedChanges(repository)
		const staged = new Set(repository.state.indexChanges.map(change => change.uri.toString()))
		const withStaged = changes.filter(change => staged.has(change.uri.toString()))
		const [all, cached, unstaged] = await Promise.all([
			this.gitDiff(repository, changes, ['HEAD']),
			this.gitDiff(repository, withStaged, ['--cached']),
			this.gitDiff(repository, withStaged, []),
		])

		return new Map(
			[...all].map(([uri, hunks]) =>
				staged.has(uri)
					? [uri, { hunks, staged: cached.get(uri) ?? [], unstaged: unstaged.get(uri) ?? [] }]
					: [uri, { hunks }],
			),
		)
	}

	/** Changes from `git diff` with these arguments, like `HEAD` or `--cached`, by the file's URI. */
	private async gitDiff(
		repository: Repository,
		changes: readonly Change[],
		against: readonly string[],
	): Promise<Map<string, Hunk[]>> {
		if (changes.length === 0) return new Map()

		const root = repository.rootUri
		const paths = changes.map(change => path.posix.relative(root.path, change.uri.path))
		const args = ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames']
		const output = await runGit(this.gitPath, root.fsPath, [...args, ...against, '--', ...paths])

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
