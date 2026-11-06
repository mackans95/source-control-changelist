// The `changelist.*` commands: the view's title buttons, and the actions on its rows. A row's
// action passes its node; a row's right-click menu passes its `data-vscode-context`, which is
// turned back into the node first. Switching branch runs the Git extension's own command.
// Changelists are the extension's own: Git only sees what they stage and commit. Fetch All, Pull
// All, Checkout Default and the Repositories panel's row buttons run through operations.ts, which
// shows each repository's status on its row.
import * as path from 'path'
import * as vscode from 'vscode'
import { Status } from './constants/git.ts'
import { GROUP_LABELS, changelistOf, groupChanges, needsPull, repositoryName } from './changelistModel.ts'
import { type Operations, VIEW_PROGRESS } from './operations.ts'
import type { ChangelistStore } from './changelistStore.ts'
import type { ChangelistWebviewProvider } from './changelistWebview.ts'
import type { API, Change, Repository } from './types/git.ts'
import type {
	ChangelistPick,
	FolderNode,
	GroupNode,
	Node,
	RepositoryNode,
	ResourceNode,
	ViewMode,
} from './types/extension.ts'
import type { GroupKind, MenuContext } from './types/shared.ts'

// The groups a repository's Stage All button stages. Files in a changelist aren't in them.
const UNSTAGED_KINDS: GroupKind[] = ['merge', 'changes', 'untracked']

/** The View as Tree and View as List buttons: saves the choice in the user's settings. */
function setViewMode(mode: ViewMode): Thenable<void> {
	return vscode.workspace.getConfiguration('changelist').update('viewMode', mode, vscode.ConfigurationTarget.Global)
}

// The Git extension's commands take the repository as their first argument, and then skip the repository picker.
function runGitCommand(command: string, node: RepositoryNode): Thenable<unknown> {
	return vscode.commands.executeCommand(command, node.repository)
}

/**
 * Publishes the branch to the repository's only remote. With several remotes or none, the Git
 * extension's own Publish Branch asks where to, or offers GitHub, with the progress bar only.
 */
function publish(node: RepositoryNode, operations: Operations): Thenable<unknown> {
	const { remotes, HEAD } = node.repository.state

	if (remotes.length === 1 && HEAD?.name) {
		const branch = HEAD.name
		return operations.runSingle('publish', node.repository, r => r.push(remotes[0].name, branch, true))
	}

	return vscode.window.withProgress(VIEW_PROGRESS, () => runGitCommand('git.publish', node))
}

/** The changes' paths, which the Git API's add, revert and clean take. */
function paths(changes: readonly Change[]): string[] {
	return changes.map(c => c.uri.fsPath)
}

/** A count with its noun, like `1 file` or `2 files`. */
function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** A repository's unstaged changes that aren't in a changelist, which its Stage All and Commit take. */
function changesOutsideChangelists(repository: Repository, changelists: ChangelistStore): Change[] {
	return UNSTAGED_KINDS.flatMap(kind => groupChanges(repository, kind, changelists.get(repository)))
}

/**
 * Stages the changes in a group, changelist or folder, or a repository's unstaged changes that aren't
 * in a changelist.
 */
async function stageAll(node: RepositoryNode | GroupNode | FolderNode, changelists: ChangelistStore): Promise<void> {
	const changes = node.type === 'repository' ? changesOutsideChangelists(node.repository, changelists) : node.changes

	if (changes.length > 0) {
		await node.repository.add(paths(changes))
	}
}

/** Discards a file's changes, or deletes it when it's untracked, after asking. */
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

/** Discards the changes in a group or folder, and deletes its untracked files, after asking. */
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

/** Asks for the commit message, which the built-in Source Control input box shares. */
function askCommitMessage(title: string, value: string): Thenable<string | undefined> {
	return vscode.window.showInputBox({
		title,
		prompt: 'Commit message',
		value,
		validateInput: message => (message.trim() ? undefined : 'Please provide a commit message'),
	})
}

/**
 * Commits the staged changes with a message the user types. When nothing is staged, it offers to
 * stage the changes that aren't in a changelist first.
 */
async function commit(node: RepositoryNode, changelists: ChangelistStore): Promise<void> {
	const repository = node.repository
	const name = repositoryName(repository)

	if (repository.state.indexChanges.length === 0 && changesOutsideChangelists(repository, changelists).length === 0) {
		void vscode.window.showInformationMessage(
			`Everything in ${name} is in a changelist. Commit it with the changelist's Commit button.`,
		)
		return
	}

	if (repository.state.indexChanges.length === 0) {
		const what =
			changelists.get(repository).lists.length > 0 ? "the changes that aren't in a changelist" : 'all changes'
		const choice = await vscode.window.showWarningMessage(
			`There are no staged changes in ${name}. Stage ${what} and commit them?`,
			{ modal: true },
			'Stage All & Commit',
		)

		if (choice !== 'Stage All & Commit') return
	}

	const message = await askCommitMessage(`Commit to ${name}`, repository.inputBox.value)
	if (!message) {
		return
	}

	if (repository.state.indexChanges.length === 0) {
		await stageAll(node, changelists)
	}
	await repository.commit(message)
	repository.inputBox.value = ''
}

/**
 * Commits a changelist's files and nothing else. The Git API commits what's staged, so it stages the
 * list's files first, and offers to unstage the files from other lists.
 */
async function commitChangelist(node: GroupNode, changelists: ChangelistStore): Promise<void> {
	const { repository, changelist, changes } = node
	const name = repositoryName(repository)
	const lists = changelists.get(repository)
	const staged = repository.state.indexChanges
	const others = staged.filter(c => changelistOf(lists, c) !== changelist)

	if (changes.length === 0 && staged.length === others.length) {
		void vscode.window.showInformationMessage(`There is nothing to commit in ${changelist}.`)
		return
	}

	if (others.length > 0) {
		const which = others.length === 1 ? "1 staged file isn't" : `${others.length} staged files aren't`
		const choice = await vscode.window.showWarningMessage(
			`${which} in ${changelist}. Unstage the other files and commit only ${changelist}?`,
			{ modal: true },
			'Unstage & Commit',
		)

		if (choice !== 'Unstage & Commit') return
	}

	const message = await askCommitMessage(
		`Commit ${changelist} to ${name}`,
		repository.inputBox.value || (changelist ?? ''),
	)

	if (!message) return

	if (others.length > 0) {
		await repository.revert(paths(others))
	}

	if (changes.length > 0) {
		await repository.add(paths(changes))
	}

	await repository.commit(message)
	repository.inputBox.value = ''
}

/** Asks for a changelist's name, which can't be Changes or another list's. */
function askChangelistName(
	repository: Repository,
	changelists: ChangelistStore,
	title: string,
	current?: string,
): Thenable<string | undefined> {
	const taken = [GROUP_LABELS.changes, ...changelists.get(repository).lists.filter(list => list !== current)]

	return vscode.window.showInputBox({
		title,
		prompt: 'Changelist name',
		value: current,
		validateInput: value => {
			const name = value.trim()
			if (!name) return 'Please provide a name'
			if (taken.includes(name)) return `There is already a changelist called ${name}`
			return undefined
		},
	})
}

/** Makes an empty changelist in a repository, and returns its name. */
async function newChangelist(repository: Repository, changelists: ChangelistStore): Promise<string | undefined> {
	const name = (
		await askChangelistName(repository, changelists, `New Changelist in ${repositoryName(repository)}`)
	)?.trim()

	if (name) {
		await changelists.add(repository, name)
	}

	return name
}

/** Renames a changelist. */
async function renameChangelist(node: GroupNode, changelists: ChangelistStore): Promise<void> {
	const { repository, changelist } = node
	const name = (await askChangelistName(repository, changelists, 'Rename Changelist', changelist))?.trim()

	if (changelist && name && name !== changelist) {
		await changelists.rename(repository, changelist, name)
	}
}

/**
 * Moves a file, a folder's files or a group's files to another changelist, picked from a list that
 * can also make a new one.
 */
async function moveToChangelist(
	node: GroupNode | FolderNode | ResourceNode,
	changelists: ChangelistStore,
): Promise<void> {
	const { repository, changelist } = node
	const changes = node.type === 'resource' ? [node.change] : node.changes
	const picks: ChangelistPick[] = [
		// Files only go back to Changes from a list. Untracked files go back to Untracked Changes.
		...(changelist === undefined ? [] : [{ label: GROUP_LABELS.changes, isNew: false }]),
		...changelists
			.get(repository)
			.lists.filter(list => list !== changelist)
			.map(list => ({ label: list, changelist: list, isNew: false })),
		{ label: '$(add) New Changelist...', isNew: true },
	]
	const pick = await vscode.window.showQuickPick(picks, { title: 'Move to Changelist', placeHolder: 'Changelist' })

	if (!pick) return

	const target = pick.isNew ? await newChangelist(repository, changelists) : pick.changelist

	if (pick.isNew && !target) return

	await changelists.move(repository, changes, target)
}

/**
 * Opens a file's changes like the built-in view does: a diff of the staged or unstaged changes, or
 * just the file when there is nothing to compare it with.
 */
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

/** Reveals the repository's folder in Finder, or in the file manager on Windows and Linux. */
function revealInOS(node: RepositoryNode): Thenable<unknown> {
	return vscode.commands.executeCommand('revealFileInOS', node.repository.rootUri)
}

/** Fetches every repository that has a remote, so the Repositories panel knows what there is to pull. */
function fetchAll(git: API, operations: Operations): Promise<void> {
	const repositories = git.repositories.filter(r => r.state.remotes.length > 0)
	return operations.run('fetch', repositories, r => r.fetch())
}

/**
 * Pulls every repository that has commits to pull, also the diverged ones. Those can fail, depending
 * on how the repository is set to reconcile them, and their row says why.
 */
async function pullAll(git: API, operations: Operations): Promise<void> {
	const repositories = git.repositories.filter(needsPull)

	if (repositories.length === 0) {
		void vscode.window.showInformationMessage('No repository has commits to pull.')
		return
	}

	await operations.run('pull', repositories, r => r.pull())
}

/** Registers the `changelist.*` commands, for the view to run on its rows and in its title bar. */
export function registerCommands(
	git: API,
	provider: ChangelistWebviewProvider,
	changelists: ChangelistStore,
	operations: Operations,
): vscode.Disposable[] {
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
		vscode.commands.registerCommand('changelist.showRepositories', () => provider.showRepositories(true)),
		vscode.commands.registerCommand('changelist.showRepositoriesNeedsSync', () => provider.showRepositories(true)),
		vscode.commands.registerCommand('changelist.hideRepositories', () => provider.showRepositories(false)),
		vscode.commands.registerCommand('changelist.fetchAll', () => fetchAll(git, operations)),
		vscode.commands.registerCommand('changelist.pullAll', () => pullAll(git, operations)),
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
			withNode((node: RepositoryNode | GroupNode | FolderNode) => stageAll(node, changelists)),
		),
		vscode.commands.registerCommand(
			'changelist.unstageAll',
			withNode((node: GroupNode | FolderNode) => node.repository.revert(paths(node.changes))),
		),
		vscode.commands.registerCommand(
			'changelist.commit',
			withNode((node: RepositoryNode) => commit(node, changelists)),
		),
		vscode.commands.registerCommand(
			'changelist.commitChangelist',
			withNode((node: GroupNode) => commitChangelist(node, changelists)),
		),
		vscode.commands.registerCommand(
			'changelist.newChangelist',
			withNode((node: Node) => newChangelist(node.repository, changelists)),
		),
		vscode.commands.registerCommand(
			'changelist.renameChangelist',
			withNode((node: GroupNode) => renameChangelist(node, changelists)),
		),
		vscode.commands.registerCommand(
			'changelist.deleteChangelist',
			withNode((node: GroupNode) => node.changelist && changelists.remove(node.repository, node.changelist)),
		),
		vscode.commands.registerCommand(
			'changelist.moveToChangelist',
			withNode((node: GroupNode | FolderNode | ResourceNode) => moveToChangelist(node, changelists)),
		),

		vscode.commands.registerCommand(
			'changelist.checkout',
			withNode((node: RepositoryNode) => runGitCommand('git.checkout', node)),
		),
		vscode.commands.registerCommand(
			'changelist.push',
			withNode((node: RepositoryNode) => operations.runSingle('push', node.repository, r => r.push())),
		),
		vscode.commands.registerCommand(
			'changelist.pull',
			withNode((node: RepositoryNode) => operations.runSingle('pull', node.repository, r => r.pull())),
		),
		vscode.commands.registerCommand(
			'changelist.sync',
			withNode((node: RepositoryNode) =>
				operations.runSingle('sync', node.repository, async r => {
					await r.pull()
					await r.push()
				}),
			),
		),
		vscode.commands.registerCommand(
			'changelist.publish',
			withNode((node: RepositoryNode) => publish(node, operations)),
		),

		vscode.commands.registerCommand(
			'changelist.fetch',
			withNode((node: RepositoryNode) => operations.runSingle('fetch', node.repository, r => r.fetch())),
		),

		vscode.commands.registerCommand(
			'changelist.openInNewWindow',
			withNode((node: RepositoryNode) =>
				vscode.commands.executeCommand('vscode.openFolder', node.repository.rootUri, { forceNewWindow: true }),
			),
		),
		vscode.commands.registerCommand('changelist.revealInFinder', withNode(revealInOS)),
		vscode.commands.registerCommand('changelist.revealInFileExplorer', withNode(revealInOS)),
		vscode.commands.registerCommand(
			'changelist.copyPath',
			withNode((node: RepositoryNode) => vscode.env.clipboard.writeText(node.repository.rootUri.fsPath)),
		),
	]
}
