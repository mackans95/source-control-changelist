// What Discard asks before it discards changes and deletes untracked files. No vscode, so the tests run it.
import * as path from 'path'
import { Status } from '#constants/git.ts'
import { GROUP_LABELS } from '#model/changes.ts'
import type { GroupNode } from '#types/extension.ts'
import type { Change } from '#types/git.ts'

/** What Discard asks: about the file by name when it's one, or else how many files it discards and deletes. */
export function discardQuestion(groups: readonly GroupNode[], split: boolean): string {
	const changes = groups.flatMap(group => group.changes.map(change => ({ group, change })))

	if (changes.length === 1) {
		const [{ group, change }] = changes
		const name = path.basename(change.uri.fsPath)

		if (isUntracked(group, change)) return `Are you sure you want to DELETE ${name}? This is IRREVERSIBLE!`

		return split
			? `Are you sure you want to discard the changes in ${name} that are in ${group.changelist ?? GROUP_LABELS.changes}?`
			: `Are you sure you want to discard changes in ${name}?`
	}

	const untracked = changes.filter(({ group, change }) => isUntracked(group, change)).length
	const tracked = changes.length - untracked
	const parts = [
		tracked > 0 ? `discard ALL changes in ${count(tracked, 'file')}` : '',
		untracked > 0 ? `DELETE ${count(untracked, 'untracked file')}` : '',
	].filter(Boolean)

	return `Are you sure you want to ${parts.join(' and ')}? This is IRREVERSIBLE!`
}

/** Whether discarding a change deletes the file. A changelist's untracked files are in its `changes` group. */
function isUntracked(group: GroupNode, change: Change): boolean {
	return group.kind === 'untracked' || change.status === Status.UNTRACKED
}

/** A count with its noun, like `1 file` or `2 files`. */
function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`
}
