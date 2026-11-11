// Fake repositories and changes with just enough of the Git API for the model's functions.
import type * as vscode from 'vscode'
import { Status } from '../src/constants/git.ts'
import type { Branch, Change, Repository } from '../src/types/git.ts'

// A branch's upstream, for a branch that's published.
export const upstream = { remote: 'origin', name: 'main' }

/** A URI with the `path` and `fsPath` the model reads, and `with` for making folders' URIs. */
export function uri(path: string): vscode.Uri {
	return {
		path,
		fsPath: path,
		with: ({ path }: { path: string }) => uri(path),
		toString: () => `file://${path}`,
	} as never
}

/** A change to a file in `/repo`. */
export function change(path: string, status: (typeof Status)[keyof typeof Status] = Status.MODIFIED): Change {
	return { uri: uri(`/repo/${path}`), originalUri: uri(`/repo/${path}`), renameUri: undefined, status }
}

/** A repository at `/repo` with these changes in its groups. */
export function repository(groups: {
	merge?: Change[]
	staged?: Change[]
	changes?: Change[]
	untracked?: Change[]
}): Repository {
	return {
		rootUri: uri('/repo'),
		state: {
			mergeChanges: groups.merge ?? [],
			indexChanges: groups.staged ?? [],
			workingTreeChanges: groups.changes ?? [],
			untrackedChanges: groups.untracked ?? [],
		},
	} as never
}

/** A clean repository whose HEAD is this branch, or a detached HEAD without one. */
export function onBranch(head: Partial<Branch> | undefined, path = '/repo'): Repository {
	return { rootUri: uri(path), state: { HEAD: head } } as never
}

/** A worktree in its own folder, of the repository in `main`. */
export function worktree(path: string, main: string): Repository {
	return { rootUri: uri(path), kind: 'worktree', state: { worktrees: [{ path: main, main: true }] } } as never
}
