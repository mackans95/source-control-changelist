// Every repository's changelists, saved in the workspace's state on this machine, like PyCharm saves
// them with the project. Git doesn't know about them.
import * as vscode from 'vscode'
import { changedUris } from '../model/changes.ts'
import { claimNewChanges, pruneChangelists } from '../model/changelists.ts'
import type { Change, Repository } from '../types/git.ts'
import type { RepositoryChangelists } from '../types/extension.ts'

// The workspace state's key, with every repository's changelists by the repository's root URI.
const STATE_KEY = 'changelists'
// A repository without changelists.
const NO_CHANGELISTS: RepositoryChangelists = { lists: [], files: {} }

/** Every repository's changelists, saved in the workspace's state. */
export class ChangelistStore implements vscode.Disposable {
	// The workspace's state.
	private readonly state: vscode.Memento
	// The files with changes at Git's last check, by repository root URI.
	private readonly known = new Map<string, ReadonlySet<string>>()
	private readonly changeEmitter = new vscode.EventEmitter<void>()

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
		const rename = (name: string | undefined) => (name === from ? to : name)
		const files = Object.entries(changelists.files).map(([uri, name]) => [uri, rename(name)])
		const hunks = Object.entries(changelists.hunks ?? {}).map(([uri, file]) => [
			uri,
			{ ...file, hunks: file.hunks.map(hunk => ({ ...hunk, list: rename(hunk.list) })) },
		])

		return this.set(repository, {
			lists: changelists.lists.map(name => (name === from ? to : name)),
			files: Object.fromEntries(files),
			active: rename(changelists.active),
			descriptions: Object.fromEntries(
				Object.entries(changelists.descriptions ?? {}).map(([list, text]) => [rename(list), text]),
			),
			hunks: changelists.hunks && Object.fromEntries(hunks),
		})
	}

	/** Deletes a changelist. Its files go back to Changes or Untracked Changes, and its changes to their file's list. */
	remove(repository: Repository, name: string): Promise<void> {
		const changelists = this.get(repository)
		const files = Object.entries(changelists.files).filter(([, list]) => list !== name)
		// Without its saved changes, they follow their file's list. The next check tidies up what's left.
		const hunks = Object.entries(changelists.hunks ?? {}).map(([uri, file]) => [
			uri,
			{ ...file, hunks: file.hunks.filter(hunk => hunk.list !== name) },
		])

		return this.set(repository, {
			lists: changelists.lists.filter(list => list !== name),
			files: Object.fromEntries(files),
			active: changelists.active === name ? undefined : changelists.active,
			descriptions: Object.fromEntries(
				Object.entries(changelists.descriptions ?? {}).filter(([list]) => list !== name),
			),
			hunks: changelists.hunks && Object.fromEntries(hunks),
		})
	}

	/** Makes a changelist the one new changes go to, or none, so they stay in Changes. */
	setActive(repository: Repository, name: string | undefined): Promise<void> {
		return this.set(repository, { ...this.get(repository), active: name })
	}

	/** Sets a changelist's description, which its Commit uses as the message. An empty one removes it. */
	setDescription(repository: Repository, name: string, description: string): Promise<void> {
		const changelists = this.get(repository)
		const descriptions = Object.entries(changelists.descriptions ?? {}).filter(([list]) => list !== name)

		if (description) {
			descriptions.push([name, description])
		}

		return this.set(repository, { ...changelists, descriptions: Object.fromEntries(descriptions) })
	}

	/** Moves whole files to a changelist, or out of every changelist when `name` is undefined. */
	move(repository: Repository, changes: readonly Change[], name: string | undefined): Promise<void> {
		const files = { ...this.get(repository).files }
		// A split file moves with all of its changes.
		const hunks = { ...this.get(repository).hunks }

		for (const change of changes) {
			delete hunks[change.uri.toString()]

			if (name === undefined) {
				delete files[change.uri.toString()]
			} else {
				files[change.uri.toString()] = name
			}
		}

		return this.set(repository, {
			...this.get(repository),
			files,
			hunks: Object.keys(hunks).length > 0 ? hunks : undefined,
		})
	}

	/** Changes a repository's changelists, and draws the view again when that changed anything. */
	async update(
		repository: Repository,
		change: (changelists: RepositoryChangelists) => RepositoryChangelists,
	): Promise<void> {
		const changelists = this.get(repository)
		const updated = change(changelists)

		if (JSON.stringify(updated) !== JSON.stringify(changelists)) {
			await this.set(repository, updated)
		}
	}

	/** Puts the files changed since Git's last check in the active list, and forgets the unchanged ones. */
	track(repository: Repository): void {
		// Before Git's first check, the repository looks like it has no changes.
		if (!repository.state.HEAD) return

		const key = repository.rootUri.toString()
		const changed = changedUris(repository)
		const known = this.known.get(key)

		this.known.set(key, changed)

		// The first check only notes what has changed already, which stays where it is.
		const changelists = this.get(repository)
		const claimed = known ? claimNewChanges(changelists, known, changed) : changelists
		const tracked = pruneChangelists(repository, claimed)

		// Without firing onDidChange: the view's update after Git's check draws it.
		if (JSON.stringify(tracked) !== JSON.stringify(changelists)) {
			void this.save(repository, tracked)
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
