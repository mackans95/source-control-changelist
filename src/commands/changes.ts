// Opening, staging, unstaging and discarding files' changes.
import * as path from 'path'
import * as vscode from 'vscode'
import { changesOf, forNodes } from './nodes.ts'
import { Status } from '../constants/git.ts'
import { GROUP_LABELS } from '#model/changes.ts'
import { partUri } from '#view/hunkDocuments.ts'
import { unlistedChanges } from '#model/changelists.ts'
import { discardParts, partsOf, stageParts, unstageParts } from './parts.ts'
import type { ChangelistStore } from '#state/changelistStore.ts'
import type { CommandTable, FolderNode, GroupNode, ResourceNode, Services } from '#types/extension.ts'
import type { API, Change } from '#types/git.ts'

/** The commands on files, folders and groups. */
export function changeCommands(services: Services): CommandTable {
	const { git, changelists } = services

	return {
		openChange: forNodes(['resource'], node =>
			vscode.commands.executeCommand(...openChangeCommand(git, changelists, node)),
		),
		openFile: forNodes(['resource'], node => vscode.window.showTextDocument(node.change.uri)),
		stage: forNodes(['resource'], async node => {
			// A split file's row stages only its list's changes.
			const parts = await partsOf(services, node.repository, [node.change], node.changelist)
			await stageParts(services, node.repository, parts)
		}),
		unstage: forNodes(['resource'], async node => {
			// From Staged Changes the whole file, and from a list a split file's part in it.
			const parts =
				node.kind === 'staged'
					? { whole: [node.change], split: [] }
					: await partsOf(services, node.repository, [node.change], node.changelist)
			await unstageParts(services, node.repository, parts)
		}),
		discard: forNodes(['resource'], node => discard(services, node)),
		discardAll: forNodes(['group', 'folder'], node => discardAll(services, node)),
		stageAll: forNodes(['repository', 'group', 'folder'], async node => {
			// A repository's Stage All leaves the changelists' files alone, and their parts of split files.
			const changes =
				node.type === 'repository'
					? unlistedChanges(node.repository, changelists.get(node.repository))
					: changesOf(node)
			const list = node.type === 'repository' ? undefined : node.changelist

			await stageParts(services, node.repository, await partsOf(services, node.repository, changes, list))
		}),
		unstageAll: forNodes(['group', 'folder'], async node => {
			// From Staged Changes the whole files, and from a list only its parts of split files.
			const parts =
				node.kind === 'staged'
					? { whole: node.changes, split: [] }
					: await partsOf(services, node.repository, node.changes, node.changelist)
			await unstageParts(services, node.repository, parts)
		}),
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

	// From a list, a file with staged changes shows all of its changes, against HEAD.
	if (changelist !== undefined && hasStaged(node)) {
		return change.status === Status.INDEX_DELETED || change.status === Status.DELETED
			? ['vscode.open', git.toGitUri(change.originalUri, 'HEAD'), {}, `${name} (Deleted)`]
			: ['vscode.diff', git.toGitUri(change.originalUri, 'HEAD'), change.uri, `${name} (${changelist})`]
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

/** Discards a file's changes, or deletes it when it's untracked, after asking. A split file loses only its list's. */
async function discard(services: Services, node: ResourceNode): Promise<void> {
	const name = path.basename(node.change.uri.fsPath)
	const parts = await partsOf(services, node.repository, [node.change], node.changelist)
	const list = node.changelist ?? GROUP_LABELS.changes
	const message = isUntracked(node, node.change)
		? `Are you sure you want to DELETE ${name}? This is IRREVERSIBLE!`
		: parts.split.length > 0
			? `Are you sure you want to discard the changes in ${name} that are in ${list}?`
			: `Are you sure you want to discard changes in ${name}?`
	const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Discard')

	if (choice === 'Discard') {
		await discardParts(services, node.repository, parts)
	}
}

/** Discards the changes in a group or folder, and deletes its untracked files, after asking. */
async function discardAll(services: Services, node: GroupNode | FolderNode): Promise<void> {
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
		// A split file loses only the changes in this group's list.
		await discardParts(
			services,
			node.repository,
			await partsOf(services, node.repository, changes, node.changelist),
		)
	}
}

/** Whether a file has staged changes. */
function hasStaged({ repository, change }: ResourceNode): boolean {
	return repository.state.indexChanges.some(c => c.uri.toString() === change.uri.toString())
}

/** Whether discarding a change deletes the file. A changelist's untracked files are in its `changes` group. */
function isUntracked(node: GroupNode | FolderNode | ResourceNode, change: Change): boolean {
	return node.kind === 'untracked' || change.status === Status.UNTRACKED
}

/** A count with its noun, like `1 file` or `2 files`. */
function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`
}
