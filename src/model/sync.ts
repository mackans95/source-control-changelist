// Where a repository's branch stands against its upstream, and why a Git command failed.
import type { Repository } from '../types/git.ts'
import type { SyncState } from '../types/shared.ts'

// The line of Git's output that says what went wrong.
const ERROR_LINE = /^(fatal|error): /

/** Where the branch stands against its upstream, as of Git's last fetch. */
export function syncState(repository: Repository): SyncState {
	const head = repository.state.HEAD
	const isAhead = (head?.ahead ?? 0) > 0
	const isBehind = (head?.behind ?? 0) > 0

	switch (true) {
		case !head?.name:
			return 'detached'
		case !head?.upstream:
			return 'unpublished'
		case isAhead && isBehind:
			return 'diverged'
		case isAhead:
			return 'ahead'
		case isBehind:
			return 'behind'
		default:
			return 'synced'
	}
}

/** Whether the branch has commits to push or pull. An unpublished branch doesn't count. */
export function needsSync(repository: Repository): boolean {
	const state = syncState(repository)
	return state === 'ahead' || state === 'behind' || state === 'diverged'
}

/** Whether the branch has commits to pull, so Pull All pulls it. */
export function needsPull(repository: Repository): boolean {
	const state = syncState(repository)
	return state === 'behind' || state === 'diverged'
}

/** A failed Git command's error in one line: its `fatal:` or `error:` line, or else its last line. */
export function gitErrorMessage(error: unknown): string {
	// Git's hints before that line explain the options, which a tooltip has no room for.
	const lines = stderrLines(error)
	const reason = lines.find(line => ERROR_LINE.test(line)) ?? lines.at(-1)

	if (reason) {
		return reason.replace(ERROR_LINE, '')
	}

	return error instanceof Error ? error.message : String(error)
}

/** The lines Git wrote to stderr, which the Git extension puts on the error it throws. */
function stderrLines(error: unknown): string[] {
	const stderr = (error as { stderr?: unknown } | undefined)?.stderr

	if (typeof stderr !== 'string') {
		return []
	}

	return stderr
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean)
}
