import * as path from 'path'
import * as vscode from 'vscode'
import {
	ChangelistProvider,
	FolderNode,
	GroupKind,
	GroupNode,
	RepositoryNode,
	ResourceNode,
	ViewMode,
	getChanges,
	repositoryName,
} from './changelistView'
import { API, Change, Status } from './typings/git'

const UNSTAGED_KINDS: GroupKind[] = ['merge', 'changes', 'untracked']

export function registerCommands(git: API, provider: ChangelistProvider): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('changelist.refresh', () => provider.refresh()),
		vscode.commands.registerCommand('changelist.viewAsTree', () => setViewMode('tree')),
		vscode.commands.registerCommand('changelist.viewAsList', () => setViewMode('list')),
		vscode.commands.registerCommand('changelist.collapseAll', () => setAllExpanded(provider, false)),
		vscode.commands.registerCommand('changelist.expandAll', () => setAllExpanded(provider, true)),
		vscode.commands.registerCommand('changelist.openChange', (node: ResourceNode) => openChange(git, node)),
		vscode.commands.registerCommand('changelist.openFile', (node: ResourceNode) =>
			vscode.window.showTextDocument(node.change.uri),
		),
		vscode.commands.registerCommand('changelist.stage', (node: ResourceNode) =>
			node.repository.add([node.change.uri.fsPath]),
		),
		vscode.commands.registerCommand('changelist.unstage', (node: ResourceNode) =>
			node.repository.revert([node.change.uri.fsPath]),
		),
		vscode.commands.registerCommand('changelist.discard', (node: ResourceNode) => discard(node)),
		vscode.commands.registerCommand('changelist.stageAll', (node: RepositoryNode | GroupNode | FolderNode) =>
			stageAll(node),
		),
		vscode.commands.registerCommand('changelist.unstageAll', (node: GroupNode | FolderNode) =>
			node.repository.revert(paths(node.changes)),
		),
		vscode.commands.registerCommand('changelist.commit', (node: RepositoryNode) => commit(node)),
	]
}

function setViewMode(mode: ViewMode): Thenable<void> {
	return vscode.workspace.getConfiguration('changelist').update('viewMode', mode, vscode.ConfigurationTarget.Global)
}

function setAllExpanded(provider: ChangelistProvider, expanded: boolean): void {
	provider.setAllExpanded(expanded)
	vscode.commands.executeCommand('setContext', 'changelist.allCollapsed', !expanded)
}

function paths(changes: readonly Change[]): string[] {
	return changes.map(c => c.uri.fsPath)
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
