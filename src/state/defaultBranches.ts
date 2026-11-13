// Each repository's default branch, for Checkout Default. The Git API doesn't have it, so this runs
// git itself.
import * as vscode from 'vscode'
import { runGit } from '#helpers/git.ts'
import type { Repository } from '../types/git.ts'
// The branches to look for when the remote doesn't say, in this order.
const FALLBACK_BRANCHES = ['main', 'master']

/** Every repository's default branch, looked up when the Repositories panel opens or is refreshed. */
export class DefaultBranches implements vscode.Disposable {
	// The git the Git extension uses.
	private readonly gitPath: string
	// By repository root URI.
	private readonly branches = new Map<string, string | undefined>()
	private readonly changeEmitter = new vscode.EventEmitter<void>()

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

	/** Stops the change event. */
	dispose(): void {
		this.changeEmitter.dispose()
	}
}

/** The branch the remote's HEAD points to, like `origin/HEAD` after a clone, or else main or master. */
async function findDefaultBranch(gitPath: string, repository: Repository): Promise<string | undefined> {
	const remote = repository.state.HEAD?.upstream?.remote ?? repository.state.remotes[0]?.name

	if (remote) {
		const head = await tryGit(gitPath, repository, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`])

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

async function tryGit(gitPath: string, repository: Repository, args: string[]): Promise<string | undefined> {
	try {
		return (await runGit(gitPath, repository.rootUri.fsPath, args)).trim()
	} catch {
		return undefined
	}
}

/** Whether a ref exists in the repository, like `refs/heads/main`. */
async function hasRef(gitPath: string, repository: Repository, ref: string): Promise<boolean> {
	return (await tryGit(gitPath, repository, ['rev-parse', '--verify', '--quiet', ref])) !== undefined
}
