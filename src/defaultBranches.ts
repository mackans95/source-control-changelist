// Each repository's default branch, which Checkout Default switches to: the branch the remote's HEAD
// points to, like `origin/HEAD` after a clone, or else main or master. The Git extension's API
// doesn't have it, so this runs git itself.
import { execFile } from 'child_process'
import * as vscode from 'vscode'
import type { Repository } from './types/git.ts'

// The branches to look for when the remote doesn't say, in this order.
const FALLBACK_BRANCHES = ['main', 'master']

/** Runs git in a repository, and returns its output, or undefined when it fails. */
function runGit(gitPath: string, repository: Repository, args: string[]): Promise<string | undefined> {
	return new Promise(resolve => {
		execFile(gitPath, args, { cwd: repository.rootUri.fsPath }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim()),
		)
	})
}

/** Whether a ref exists in the repository, like `refs/heads/main`. */
async function hasRef(gitPath: string, repository: Repository, ref: string): Promise<boolean> {
	return (await runGit(gitPath, repository, ['rev-parse', '--verify', '--quiet', ref])) !== undefined
}

/** Looks up a repository's default branch, or undefined when it has none of them. */
async function findDefaultBranch(gitPath: string, repository: Repository): Promise<string | undefined> {
	const remote = repository.state.HEAD?.upstream?.remote ?? repository.state.remotes[0]?.name

	if (remote) {
		const head = await runGit(gitPath, repository, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`])

		if (head?.startsWith(`${remote}/`)) {
			return head.slice(remote.length + 1)
		}
	}

	for (const branch of FALLBACK_BRANCHES) {
		const tracked = remote !== undefined && (await hasRef(gitPath, repository, `refs/remotes/${remote}/${branch}`))

		if (tracked || (await hasRef(gitPath, repository, `refs/heads/${branch}`))) {
			return branch
		}
	}

	return undefined
}

/** Every repository's default branch, looked up when the Repositories panel opens or is refreshed. */
export class DefaultBranches implements vscode.Disposable {
	// Fires when the branches have been looked up again, so the view is drawn again.
	private readonly changeEmitter = new vscode.EventEmitter<void>()
	// Each repository's default branch, by its root URI.
	private readonly branches = new Map<string, string | undefined>()
	// The git the Git extension uses.
	private readonly gitPath: string

	// When the branches have been looked up again.
	readonly onDidChange = this.changeEmitter.event

	constructor(gitPath: string) {
		this.gitPath = gitPath
	}

	/** A repository's default branch, if it's been looked up and it has one. */
	get(repository: Repository): string | undefined {
		return this.branches.get(repository.rootUri.toString())
	}

	/** Looks up the repositories' default branches again. */
	async refresh(repositories: readonly Repository[]): Promise<void> {
		const found = await Promise.all(repositories.map(repository => findDefaultBranch(this.gitPath, repository)))
		repositories.forEach((r, i) => this.branches.set(r.rootUri.toString(), found[i]))
		this.changeEmitter.fire()
	}

	/** Stops the change event */
	dispose(): void {
		this.changeEmitter.dispose()
	}
}
