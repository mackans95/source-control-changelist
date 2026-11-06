// The changelists in each repository: the lists the user made, and which files are in them. They're
// saved in the workspace's state, on this machine, like PyCharm saves them with the project. Git
// and the built-in Source Control view don't know about them.
import * as vscode from 'vscode'
import { pruneChangelists } from './changelistModel.ts'
import type { Change, Repository } from './types/git.ts'
import type { RepositoryChangelists } from './types/extension.ts'

// The workspace state's key, with every repository's changelists by the repository's root URI.
const STATE_KEY = 'changelists'
// A repository without changelists.
const NO_CHANGELISTS: RepositoryChangelists = { lists: [], files: {} }

/** Every repository's changelists, saved in the workspace's state. */
export class ChangelistStore implements vscode.Disposable {
	// Fires when the user changes a changelist, so the view is drawn again.
	private readonly changeEmitter = new vscode.EventEmitter<void>()
	// Where the changelists are saved.
	private readonly state: vscode.Memento

	// When the user changes a changelist.
	readonly onDidChange = this.changeEmitter.event

	constructor(state: vscode.Memento) {
		this.state = state
	}

	/** A repository's changelists. */
	get(repository: Repository): RepositoryChangelists {
		return this.all()[repository.rootUri.toString()] ?? NO_CHANGELISTS
	}

	/** Adds an empty changelist. */
	add(repository: Repository, name: string): Promise<void> {
		const changelists = this.get(repository)
		return this.set(repository, { ...changelists, lists: [...changelists.lists, name] })
	}

	/** Renames a changelist, and keeps its files in it. */
	rename(repository: Repository, from: string, to: string): Promise<void> {
		const changelists = this.get(repository)
		const files = Object.entries(changelists.files).map(([uri, name]) => [uri, name === from ? to : name])

		return this.set(repository, {
			lists: changelists.lists.map(name => (name === from ? to : name)),
			files: Object.fromEntries(files),
		})
	}

	/** Deletes a changelist. Its files go back to Changes, or to Untracked Changes. */
	remove(repository: Repository, name: string): Promise<void> {
		const changelists = this.get(repository)
		const files = Object.entries(changelists.files).filter(([, list]) => list !== name)

		return this.set(repository, {
			lists: changelists.lists.filter(list => list !== name),
			files: Object.fromEntries(files),
		})
	}

	/** Moves changes to a changelist, or out of every changelist when `name` is undefined. */
	move(repository: Repository, changes: readonly Change[], name: string | undefined): Promise<void> {
		const files = { ...this.get(repository).files }

		for (const change of changes) {
			if (name === undefined) {
				delete files[change.uri.toString()]
			} else {
				files[change.uri.toString()] = name
			}
		}

		return this.set(repository, { ...this.get(repository), files })
	}

	/**
	 * Forgets the files that have no changes any more. It's called after Git checks the repository's
	 * status, and doesn't draw the view again: the update that follows does.
	 */
	prune(repository: Repository): void {
		const changelists = this.get(repository)
		const pruned = pruneChangelists(repository, changelists)

		if (Object.keys(pruned.files).length !== Object.keys(changelists.files).length) {
			void this.save(repository, pruned)
		}
	}

	/** Stops the change event. */
	dispose(): void {
		this.changeEmitter.dispose()
	}

	/** Every repository's changelists. */
	private all(): Readonly<Record<string, RepositoryChangelists>> {
		return this.state.get<Record<string, RepositoryChangelists>>(STATE_KEY, {})
	}

	/** Saves a repository's changelists. */
	private save(repository: Repository, changelists: RepositoryChangelists): Thenable<void> {
		return this.state.update(STATE_KEY, { ...this.all(), [repository.rootUri.toString()]: changelists })
	}

	/** Saves a repository's changelists after the user changed them, and draws the view again. */
	private async set(repository: Repository, changelists: RepositoryChangelists): Promise<void> {
		await this.save(repository, changelists)
		this.changeEmitter.fire()
	}
}
