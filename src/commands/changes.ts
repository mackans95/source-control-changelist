// Opening, staging, unstaging and discarding files' changes.
import * as path from 'path'
import * as vscode from 'vscode'
import { discardQuestion } from './discardQuestion.ts'
import { forSelected, groupsOf } from './nodes.ts'
import { Status } from '#constants/git.ts'
import { GROUP_LABELS } from '#model/changes.ts'
import { partUri } from '#view/hunkDocuments.ts'
import { unlistedChanges } from '#model/changelists.ts'
import { discardParts, partsOf, stageParts, unstageParts } from './parts.ts'
import type { ChangelistStore } from '#state/changelistStore.ts'
import type { CommandTable, FileParts, GroupNode, Node, ResourceNode, Services } from '#types/extension.ts'
import type { API, Change } from '#types/git.ts'
import type { GroupKind } from '#types/shared.ts'

// The rows with files, which the commands take the files of.
const FILE_ROWS = ['group', 'folder', 'resource'] as const
// The groups each command takes files from, like the right-click menus and the rows' buttons offer it.
const STAGE_KINDS: readonly GroupKind[] = ['merge', 'changes', 'untracked']
const UNSTAGE_KINDS: readonly GroupKind[] = ['staged', 'changes']
const DISCARD_KINDS: readonly GroupKind[] = ['changes', 'untracked']

/** The commands on files, folders and groups. */
export function changeCommands(services: Services): CommandTable {
	const { git, changelists } = services
	const stageSelected = forSelected(FILE_ROWS, nodes => stage(services, groupsOf(nodes, STAGE_KINDS)))
	const unstageSelected = forSelected(FILE_ROWS, nodes => unstage(services, groupsOf(nodes, UNSTAGE_KINDS)))
	const discardSelected = forSelected(FILE_ROWS, nodes => discard(services, groupsOf(nodes, DISCARD_KINDS)))

	return {
		openChange: forSelected(['resource'], nodes => openChanges(git, changelists, nodes)),
		openFile: forSelected(['resource'], nodes => openFiles(nodes)),
		// A file's, folder's and group's Stage, Unstage and Discard do the same: what's in the rows.
		stage: stageSelected,
		unstage: unstageSelected,
		discard: discardSelected,
		discardAll: discardSelected,
		unstageAll: unstageSelected,
		stageAll: async (node: Node | undefined, selected?: readonly Node[]) => {
			if (node?.type !== 'repository') return stageSelected(node, selected)

			// A repository's Stage All leaves the changelists' files alone, and their parts of split files.
			const changes = unlistedChanges(node.repository, changelists.get(node.repository))
			await stageParts(services, node.repository, await partsOf(services, node.repository, changes, undefined))
		},
	}
}

/** Opens the files' changes. Several open in tabs that stay, instead of each replacing the last in the preview. */
async function openChanges(git: API, changelists: ChangelistStore, nodes: readonly ResourceNode[]): Promise<void> {
	const options = showOptions(nodes)

	for (const node of nodes) {
		await vscode.commands.executeCommand(...openChangeCommand(git, changelists, node, options))
	}
}

/** Opens the files. Several open in tabs that stay. */
async function openFiles(nodes: readonly ResourceNode[]): Promise<void> {
	const options = showOptions(nodes)

	for (const node of nodes) {
		await vscode.window.showTextDocument(node.change.uri, options)
	}
}

/** Stages the groups' changes. A split file's changes are staged only for the list its row is in. */
async function stage(services: Services, groups: readonly GroupNode[]): Promise<void> {
	for (const { repository, changes, changelist } of groups) {
		await stageParts(services, repository, await partsOf(services, repository, changes, changelist))
	}
}

/** Unstages the groups' staged changes: Staged Changes' whole files, and from a list its parts of split files. */
async function unstage(services: Services, groups: readonly GroupNode[]): Promise<void> {
	for (const { repository, kind, changes, changelist } of groups) {
		// A list's files that have nothing staged would only be reset for nothing.
		const staged = new Set(repository.state.indexChanges.map(c => c.uri.toString()))
		const stagedChanges = changes.filter(c => staged.has(c.uri.toString()))
		const parts =
			kind === 'staged'
				? { whole: changes, split: [] }
				: await partsOf(services, repository, stagedChanges, changelist)

		await unstageParts(services, repository, parts)
	}
}

/** Discards the groups' changes, and deletes their untracked files, after asking once. A split file loses only its list's. */
async function discard(services: Services, groups: readonly GroupNode[]): Promise<void> {
	if (groups.every(group => group.changes.length === 0)) return

	// Read before asking, so the question can say when a split file loses only its list's changes.
	const parts: FileParts[] = []

	for (const { repository, changes, changelist } of groups) {
		parts.push(await partsOf(services, repository, changes, changelist))
	}

	const split = parts.some(part => part.split.length > 0)
	const choice = await vscode.window.showWarningMessage(discardQuestion(groups, split), { modal: true }, 'Discard')

	if (choice !== 'Discard') return

	for (const [i, { repository }] of groups.entries()) {
		await discardParts(services, repository, parts[i])
	}
}

/** Tabs that stay when several files open at once, and VS Code's default otherwise. */
function showOptions(nodes: readonly ResourceNode[]): vscode.TextDocumentShowOptions {
	return nodes.length > 1 ? { preview: false } : {}
}

/** The command that opens a file's changes like the built-in view: a diff, or the file alone. */
function openChangeCommand(
	git: API,
	changelists: ChangelistStore,
	node: ResourceNode,
	options: vscode.TextDocumentShowOptions,
): [string, ...unknown[]] {
	const { change, kind, changelist } = node
	const name = path.basename(change.uri.fsPath)

	// A split file shows only the changes of the list its row is in.
	if (kind === 'changes' && changelists.get(node.repository).hunks?.[change.uri.toString()]) {
		const list = changelist ?? GROUP_LABELS.changes
		return ['vscode.diff', partUri(change.uri, changelist), change.uri, `${name} (${list})`, options]
	}

	// From a list, a file with staged changes shows all of its changes, against HEAD.
	if (changelist !== undefined && hasStaged(node)) {
		return change.status === Status.INDEX_DELETED || change.status === Status.DELETED
			? ['vscode.open', git.toGitUri(change.originalUri, 'HEAD'), options, `${name} (Deleted)`]
			: ['vscode.diff', git.toGitUri(change.originalUri, 'HEAD'), change.uri, `${name} (${changelist})`, options]
	}

	// There's nothing to compare these with.
	if (
		kind === 'merge' ||
		kind === 'untracked' ||
		change.status === Status.UNTRACKED ||
		change.status === Status.INTENT_TO_ADD
	) {
		return ['vscode.open', change.uri, options]
	}

	if (kind === 'staged') {
		return stagedChangeCommand(git, change, name, options)
	}

	// The index against the working tree.
	if (change.status === Status.DELETED) {
		return ['vscode.open', git.toGitUri(change.uri, '~'), options, `${name} (Deleted)`]
	}

	return ['vscode.diff', git.toGitUri(change.uri, '~'), change.uri, `${name} (Working Tree)`, options]
}

/** The command that opens a staged change: HEAD against the index. */
function stagedChangeCommand(
	git: API,
	change: Change,
	name: string,
	options: vscode.TextDocumentShowOptions,
): [string, ...unknown[]] {
	switch (change.status) {
		case Status.INDEX_ADDED:
			return ['vscode.open', git.toGitUri(change.uri, ''), options, `${name} (Index)`]
		case Status.INDEX_DELETED:
			return ['vscode.open', git.toGitUri(change.originalUri, 'HEAD'), options, `${name} (Deleted)`]
		default:
			return [
				'vscode.diff',
				git.toGitUri(change.originalUri, 'HEAD'),
				git.toGitUri(change.uri, ''),
				`${name} (Index)`,
				options,
			]
	}
}

/** Whether a file has staged changes. */
function hasStaged({ repository, change }: ResourceNode): boolean {
	return repository.state.indexChanges.some(c => c.uri.toString() === change.uri.toString())
}
