// The `changelist.*` commands: the view's title buttons, and the actions on its rows. A row's
// action passes its node; a row's right-click menu passes its `data-vscode-context`, which is
// turned back into the node first.
import * as path from 'path'
import * as vscode from 'vscode'
import { getChanges, repositoryName } from './changelistModel.ts'
import type { ChangelistWebviewProvider } from './changelistWebview.ts'
import { Status } from './constants/git.ts'
import type { API, Change } from './types/git.ts'
import type { FolderNode, GroupNode, Node, RepositoryNode, ResourceNode, ViewMode } from './types/extension.ts'
import type { GroupKind, MenuContext } from './types/shared.ts'

const UNSTAGED_KINDS: GroupKind[] = ['merge', 'changes', 'untracked']

function setViewMode(mode: ViewMode): Thenable<void> {
	return vscode.workspace.getConfiguration('changelist').update('viewMode', mode, vscode.ConfigurationTarget.Global)
}

// The Git extension's commands take the repository as their first argument, and then skip the repository picker.
function runGitCommand(command: string, node: RepositoryNode): Thenable<unknown> {
	return vscode.commands.executeCommand(command, node.repository)
}

function paths(changes: readonly Change[]): string[] {
	return changes.map(c => c.uri.fsPath)
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`
}

async function stageAll(node: RepositoryNode | GroupNode | FolderNode): Promise<void> {
	const changes =
		node.type === 'repository' ? UNSTAGED_KINDS.flatMap(kind => getChanges(node.repository, kind)) : node.changes
	if (changes.length > 0) {
		await node.repository.add(paths(changes))
	}
}

async function discard(node: ResourceNode): Promise<void> {
	const name = path.basename(node.change.uri.fsPath)
	const message =
		node.kind === 'untracked' || node.change.status === Status.UNTRACKED
			? `Are you sure you want to DELETE ${name}? This is IRREVERSIBLE!`
			: `Are you sure you want to discard changes in ${name}?`
	const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Discard')
	if (choice === 'Discard') {
		await node.repository.clean([node.change.uri.fsPath])
	}
}

async function discardAll(node: GroupNode | FolderNode): Promise<void> {
	const changes = node.changes

	if (changes.length === 0) return

	const untracked = changes.filter(c => node.kind === 'untracked' || c.status === Status.UNTRACKED).length
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

async function commit(node: RepositoryNode): Promise<void> {
	const repository = node.repository
	const name = repositoryName(repository)

	if (repository.state.indexChanges.length === 0) {
		const choice = await vscode.window.showWarningMessage(
			`There are no staged changes in ${name}. Stage all changes and commit them?`,
			{ modal: true },
			'Stage All & Commit',
		)
		if (choice !== 'Stage All & Commit') {
			return
		}
	}

	// Share the commit message with the built-in Source Control input box.
	const message = await vscode.window.showInputBox({
		title: `Commit to ${name}`,
		prompt: 'Commit message',
		value: repository.inputBox.value,
		validateInput: value => (value.trim() ? undefined : 'Please provide a commit message'),
	})
	if (!message) {
		return
	}

	if (repository.state.indexChanges.length === 0) {
		await stageAll(node)
	}
	await repository.commit(message)
	repository.inputBox.value = ''
}

async function openChange(git: API, node: ResourceNode): Promise<void> {
	const { change, kind } = node
	const name = path.basename(change.uri.fsPath)

	if (
		kind === 'merge' ||
		kind === 'untracked' ||
		change.status === Status.UNTRACKED ||
		change.status === Status.INTENT_TO_ADD
	) {
		await vscode.commands.executeCommand('vscode.open', change.uri)
		return
	}

	if (kind === 'staged') {
		// HEAD <-> index
		if (change.status === Status.INDEX_ADDED) {
			await vscode.commands.executeCommand('vscode.open', git.toGitUri(change.uri, ''), {}, `${name} (Index)`)
		} else if (change.status === Status.INDEX_DELETED) {
			await vscode.commands.executeCommand(
				'vscode.open',
				git.toGitUri(change.originalUri, 'HEAD'),
				{},
				`${name} (Deleted)`,
			)
		} else {
			await vscode.commands.executeCommand(
				'vscode.diff',
				git.toGitUri(change.originalUri, 'HEAD'),
				git.toGitUri(change.uri, ''),
				`${name} (Index)`,
			)
		}
		return
	}

	// index <-> working tree
	if (change.status === Status.DELETED) {
		await vscode.commands.executeCommand('vscode.open', git.toGitUri(change.uri, '~'), {}, `${name} (Deleted)`)
	} else {
		await vscode.commands.executeCommand(
			'vscode.diff',
			git.toGitUri(change.uri, '~'),
			change.uri,
			`${name} (Working Tree)`,
		)
	}
}

export function registerCommands(git: API, provider: ChangelistWebviewProvider): vscode.Disposable[] {
	// Commands run from the view's right-click menu get the row's `data-vscode-context` instead of a
	// node. The menu's `when` clauses make sure it's the right kind of row.
	const withNode =
		<T extends Node>(run: (node: T) => unknown) =>
		(arg: T | MenuContext) => {
			const node = 'webviewSection' in arg ? provider.resolveTarget(arg) : arg
			return node && run(node as T)
		}

	return [
		vscode.commands.registerCommand('changelist.refresh', () => provider.refresh()),
		vscode.commands.registerCommand('changelist.viewAsTree', () => setViewMode('tree')),
		vscode.commands.registerCommand('changelist.viewAsList', () => setViewMode('list')),
		vscode.commands.registerCommand('changelist.collapseAll', () => provider.setAllExpanded(false)),
		vscode.commands.registerCommand('changelist.expandAll', () => provider.setAllExpanded(true)),
		vscode.commands.registerCommand(
			'changelist.openChange',
			withNode((node: ResourceNode) => openChange(git, node)),
		),
		vscode.commands.registerCommand(
			'changelist.openFile',
			withNode((node: ResourceNode) => vscode.window.showTextDocument(node.change.uri)),
		),
		vscode.commands.registerCommand(
			'changelist.stage',
			withNode((node: ResourceNode) => node.repository.add([node.change.uri.fsPath])),
		),
		vscode.commands.registerCommand(
			'changelist.unstage',
			withNode((node: ResourceNode) => node.repository.revert([node.change.uri.fsPath])),
		),
		vscode.commands.registerCommand(
			'changelist.discard',
			withNode((node: ResourceNode) => discard(node)),
		),
		vscode.commands.registerCommand(
			'changelist.discardAll',
			withNode((node: GroupNode | FolderNode) => discardAll(node)),
		),
		vscode.commands.registerCommand(
			'changelist.stageAll',
			withNode((node: RepositoryNode | GroupNode | FolderNode) => stageAll(node)),
		),
		vscode.commands.registerCommand(
			'changelist.unstageAll',
			withNode((node: GroupNode | FolderNode) => node.repository.revert(paths(node.changes))),
		),
		vscode.commands.registerCommand(
			'changelist.commit',
			withNode((node: RepositoryNode) => commit(node)),
		),
		vscode.commands.registerCommand(
			'changelist.checkout',
			withNode((node: RepositoryNode) => runGitCommand('git.checkout', node)),
		),
	]
}
