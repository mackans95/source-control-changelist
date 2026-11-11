// Opening, staging, unstaging and discarding files' changes.
import * as path from 'path'
import * as vscode from 'vscode'
import { changesOf, forNodes, paths } from './nodes.ts'
import { Status } from '../constants/git.ts'
import { GROUP_LABELS } from '#model/changes.ts'
import { partUri } from '#view/hunkDocuments.ts'
import { unlistedChanges } from '#model/changelists.ts'
import type { ChangelistStore } from '#state/changelistStore.ts'
import type { CommandTable, FolderNode, GroupNode, ResourceNode, Services } from '#types/extension.ts'
import type { API, Change } from '#types/git.ts'

/** The commands on files, folders and groups. */
export function changeCommands({ git, changelists }: Services): CommandTable {
	return {
		openChange: forNodes(['resource'], node =>
			vscode.commands.executeCommand(...openChangeCommand(git, changelists, node)),
		),
		openFile: forNodes(['resource'], node => vscode.window.showTextDocument(node.change.uri)),
		stage: forNodes(['resource'], node => node.repository.add([node.change.uri.fsPath])),
		unstage: forNodes(['resource'], node => node.repository.revert([node.change.uri.fsPath])),
		discard: forNodes(['resource'], node => discard(node)),
		discardAll: forNodes(['group', 'folder'], node => discardAll(node)),
		stageAll: forNodes(['repository', 'group', 'folder'], async node => {
			// A repository's Stage All leaves the changelists' files alone.
			const changes =
				node.type === 'repository'
					? unlistedChanges(node.repository, changelists.get(node.repository))
					: changesOf(node)

			if (changes.length > 0) {
				await node.repository.add(paths(changes))
			}
		}),
		unstageAll: forNodes(['group', 'folder'], node => node.repository.revert(paths(node.changes))),
	}
}

/** The command that opens a file's changes like the built-in view: a diff, or the file alone. */
function openChangeCommand(git: API, changelists: ChangelistStore, node: ResourceNode): [string, ...unknown[]] {
	const { change, kind, changelist } = node
	const name = path.basename(change.uri.fsPath)

	// A split file shows only the changes of the list its row is in.
	if (kind === 'changes' && changelists.get(node.repository).hunks?.[change.uri.toString()]) {
		const list = changelist ?? GROUP_LABELS.changes
		return ['vscode.diff', partUri(change.uri, changelist), change.uri, `${name} (${list})`]
	}

	// There's nothing to compare these with.
	if (
		kind === 'merge' ||
		kind === 'untracked' ||
		change.status === Status.UNTRACKED ||
		change.status === Status.INTENT_TO_ADD
	) {
		return ['vscode.open', change.uri]
	}

	if (kind === 'staged') {
		return stagedChangeCommand(git, change, name)
	}

	// The index against the working tree.
	if (change.status === Status.DELETED) {
		return ['vscode.open', git.toGitUri(change.uri, '~'), {}, `${name} (Deleted)`]
	}

	return ['vscode.diff', git.toGitUri(change.uri, '~'), change.uri, `${name} (Working Tree)`]
}

/** The command that opens a staged change: HEAD against the index. */
function stagedChangeCommand(git: API, change: Change, name: string): [string, ...unknown[]] {
	switch (change.status) {
		case Status.INDEX_ADDED:
			return ['vscode.open', git.toGitUri(change.uri, ''), {}, `${name} (Index)`]
		case Status.INDEX_DELETED:
			return ['vscode.open', git.toGitUri(change.originalUri, 'HEAD'), {}, `${name} (Deleted)`]
		default:
			return [
				'vscode.diff',
				git.toGitUri(change.originalUri, 'HEAD'),
				git.toGitUri(change.uri, ''),
				`${name} (Index)`,
			]
	}
}

/** Discards a file's changes, or deletes it when it's untracked, after asking. */
async function discard(node: ResourceNode): Promise<void> {
	const name = path.basename(node.change.uri.fsPath)
	const message = isUntracked(node, node.change)
		? `Are you sure you want to DELETE ${name}? This is IRREVERSIBLE!`
		: `Are you sure you want to discard changes in ${name}?`
	const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Discard')

	if (choice === 'Discard') {
		await node.repository.clean([node.change.uri.fsPath])
	}
}

/** Discards the changes in a group or folder, and deletes its untracked files, after asking. */
async function discardAll(node: GroupNode | FolderNode): Promise<void> {
	const { changes } = node

	if (changes.length === 0) return

	const untracked = changes.filter(change => isUntracked(node, change)).length
	const tracked = changes.length - untracked
	const parts = [
		tracked > 0 ? `discard ALL changes in ${count(tracked, 'file')}` : '',
		untracked > 0 ? `DELETE ${count(untracked, 'untracked file')}` : '',
	].filter(Boolean)
	const choice = await vscode.window.showWarningMessage(
		`Are you sure you want to ${parts.join(' and ')}? This is IRREVERSIBLE!`,
		{ modal: true },
		'Discard',
	)

	if (choice === 'Discard') {
		await node.repository.clean(paths(changes))
	}
}

/** Whether discarding a change deletes the file. A changelist's untracked files are in its `changes` group. */
function isUntracked(node: GroupNode | FolderNode | ResourceNode, change: Change): boolean {
	return node.kind === 'untracked' || change.status === Status.UNTRACKED
}

/** A count with its noun, like `1 file` or `2 files`. */
function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`
}
