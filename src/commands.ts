// The `changelist.*` commands: the view's title buttons, and the actions on its rows. A row's
// action passes its node; a row's right-click menu passes its `data-vscode-context`, which is
// turned back into the node first. Switching branch runs the Git extension's own command.
// Changelists are the extension's own: Git only sees what they stage and commit. Fetch All, Pull
// All, Checkout Default and the Repositories panel's row buttons run through operations.ts, which
// shows each repository's status on its row.
import * as path from 'path'
import * as vscode from 'vscode'
import { Status } from './constants/git.ts'
import { GROUP_LABELS, hasChanges, changelistOf, groupChanges, needsPull, repositoryName } from './changelistModel.ts'
import { type Operations, VIEW_PROGRESS } from './operations.ts'
import type { ChangelistStore } from './changelistStore.ts'
import type { ChangelistWebviewProvider } from './changelistWebview.ts'
import type { DefaultBranches } from './defaultBranches.ts'
import type { RepositoryOrder } from './repositoryOrder.ts'
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

/** The `changelist.deleteChangelistsAfterCommit` setting: whether a list goes once its commit has emptied it. */
function deletesAfterCommit(): boolean {
	return vscode.workspace.getConfiguration('changelist').get<boolean>('deleteChangelistsAfterCommit', false)
}

/** Whether a changelist has no files left, which after its commit means they were all committed. */
function isEmpty(repository: Repository, changelists: ChangelistStore, changelist: string): boolean {
	return groupChanges(repository, 'changes', changelists.get(repository), changelist).length === 0
}

/**
 * Commits a changelist's files and nothing else. The Git API commits what's staged, so it stages the
 * list's files first, and offers to unstage the files from other lists. The list's description is
 * the commit message it suggests. With `changelist.deleteChangelistsAfterCommit`, the list is deleted
 * once the commit has emptied it.
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

	// The list's description is its commit message.
	const description = changelist === undefined ? undefined : lists.descriptions?.[changelist]
	const message = await askCommitMessage(
		`Commit ${changelist} to ${name}`,
		description || repository.inputBox.value || (changelist ?? ''),
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

	if (changelist !== undefined && deletesAfterCommit() && isEmpty(repository, changelists, changelist)) {
		await changelists.remove(repository, changelist)
	}
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

/** Edits a changelist's description, which its Commit uses as the commit message. */
async function editDescription(node: GroupNode, changelists: ChangelistStore): Promise<void> {
	const { repository, changelist } = node

	if (changelist === undefined) return

	const description = await vscode.window.showInputBox({
		title: `Description of ${changelist}`,
		prompt: "The commit message for the changelist's Commit. Leave it empty to use the list's name.",
		value: changelists.get(repository).descriptions?.[changelist],
	})

	if (description !== undefined) {
		await changelists.setDescription(repository, changelist, description.trim())
	}
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

/**
 * Why Checkout Default leaves a repository alone, or undefined when it switches it. A repository
 * that's on its default branch already gets neither, so it's left out without a reason.
 */
function checkoutSkipReason(repository: Repository, branch: string | undefined): string | undefined {
	switch (true) {
		case branch === undefined:
			return 'Skipped: no default branch found'
		case repository.kind === 'worktree':
			return "Skipped: it's a worktree"
		case hasChanges(repository):
			return 'Skipped: it has uncommitted changes'
		default:
			return undefined
	}
}

/**
 * Switches every repository to its default branch, after asking. Worktrees and repositories with
 * uncommitted changes are skipped, with the reason on their row.
 */
async function checkoutDefault(git: API, operations: Operations, defaultBranches: DefaultBranches): Promise<void> {
	await defaultBranches.refresh(git.repositories)

	// The repositories that switch, with the branch they switch to.
	const targets = new Map<Repository, string>()
	const skipped: [Repository, string][] = []

	for (const repo of git.repositories) {
		const branch = defaultBranches.get(repo)

		if (branch !== undefined && repo.state.HEAD?.name === branch) continue

		const reason = checkoutSkipReason(repo, branch)

		if (reason !== undefined) {
			skipped.push([repo, reason])
		} else if (branch !== undefined) {
			targets.set(repo, branch)
		}
	}

	if (targets.size > 0) {
		const choice = await vscode.window.showWarningMessage(
			`Switch ${targets.size === 1 ? '1 repository' : `${targets.size} repositories`} to the default branch?`,
			{ modal: true, detail: [...targets].map(([r, branch]) => `${repositoryName(r)}: ${branch}`).join('\n') },
			'Switch',
		)

		if (choice !== 'Switch') return
	} else {
		void vscode.window.showInformationMessage('Every repository that can switch is on its default branch.')
	}

	await operations.run('checkout', [...targets.keys()], r => r.checkout(targets.get(r) ?? ''), skipped)
}

/** Registers the `changelist.*` commands, for the view to run on its rows and in its title bar. */
export function registerCommands(
	git: API,
	provider: ChangelistWebviewProvider,
	changelists: ChangelistStore,
	operations: Operations,
	defaultBranches: DefaultBranches,
	repositoryOrder: RepositoryOrder,
): vscode.Disposable[] {
	/**
	 * Commands run from the view's right-click menu get the row's `data-vscode-context` instead of a
	 * node. The menu's `when` clauses make sure it's the right kind of row.
	 */
	const withNode =
		<K extends Node['type']>(types: readonly K[], run: (node: Extract<Node, { type: K }>) => unknown) =>
		(arg: Node | MenuContext) => {
			const node = 'webviewSection' in arg ? provider.resolveTarget(arg) : arg
			return node && types.includes(node.type as K) ? run(node as Extract<Node, { type: K }>) : undefined
		}

	/** Registers a command under changelist. */
	const register = (name: string, action: (...args: any) => unknown) => {
		return vscode.commands.registerCommand(`changelist.${name}`, action)
	}

	return [
		register('refresh', () => provider.refresh()),
		register('viewAsTree', () => setViewMode('tree')),
		register('viewAsList', () => setViewMode('list')),
		register('collapseAll', () => provider.setAllExpanded(false)),
		register('expandAll', () => provider.setAllExpanded(true)),
		register('showRepositories', () => provider.showRepositories(true)),
		register('showRepositoriesNeedsSync', () => provider.showRepositories(true)),
		register('hideRepositories', () => provider.showRepositories(false)),
		register('fetchAll', () => fetchAll(git, operations)),
		register('pullAll', () => pullAll(git, operations)),
		register('checkoutDefault', () => checkoutDefault(git, operations, defaultBranches)),
		register('resetRepositoryOrder', () => repositoryOrder.reset()),
		register(
			'openChange',
			withNode(['resource'], node => openChange(git, node)),
		),
		register(
			'openFile',
			withNode(['resource'], node => vscode.window.showTextDocument(node.change.uri)),
		),
		register(
			'stage',
			withNode(['resource'], node => node.repository.add([node.change.uri.fsPath])),
		),
		register(
			'unstage',
			withNode(['resource'], node => node.repository.revert([node.change.uri.fsPath])),
		),
		register(
			'discard',
			withNode(['resource'], node => discard(node)),
		),
		register(
			'discardAll',
			withNode(['group', 'folder'], node => discardAll(node)),
		),
		register(
			'stageAll',
			withNode(['repository', 'group', 'folder'], node => stageAll(node, changelists)),
		),
		register(
			'unstageAll',
			withNode(['group', 'folder'], node => node.repository.revert(paths(node.changes))),
		),
		register(
			'commit',
			withNode(['repository'], node => commit(node, changelists)),
		),
		register(
			'commitChangelist',
			withNode(['group'], node => commitChangelist(node, changelists)),
		),
		register(
			'newChangelist',
			withNode(['folder', 'group', 'repository', 'resource'], node =>
				newChangelist(node.repository, changelists),
			),
		),
		register(
			'setActiveChangelist',
			withNode(['group'], node => changelists.setActive(node.repository, node.changelist)),
		),
		register(
			'renameChangelist',
			withNode(['group'], node => renameChangelist(node, changelists)),
		),
		register(
			'editChangelistDescription',
			withNode(['group'], node => editDescription(node, changelists)),
		),
		register(
			'deleteChangelist',
			withNode(['group'], node => node.changelist && changelists.remove(node.repository, node.changelist)),
		),
		register(
			'moveToChangelist',
			withNode(['group', 'folder', 'resource'], node => moveToChangelist(node, changelists)),
		),
		register(
			'checkout',
			withNode(['repository'], node => runGitCommand('git.checkout', node)),
		),
		register(
			'push',
			withNode(['repository'], node => operations.runSingle('push', node.repository, r => r.push())),
		),
		register(
			'pull',
			withNode(['repository'], node => operations.runSingle('pull', node.repository, r => r.pull())),
		),
		register(
			'sync',
			withNode(['repository'], node =>
				operations.runSingle('sync', node.repository, async r => {
					await r.pull()
					await r.push()
				}),
			),
		),
		register(
			'publish',
			withNode(['repository'], node => publish(node, operations)),
		),
		register(
			'fetch',
			withNode(['repository'], node => operations.runSingle('fetch', node.repository, r => r.fetch())),
		),
		register(
			'openInNewWindow',
			withNode(['repository'], node =>
				vscode.commands.executeCommand('vscode.openFolder', node.repository.rootUri, { forceNewWindow: true }),
			),
		),
		register('revealInFinder', withNode(['repository'], revealInOS)),
		register('revealInFileExplorer', withNode(['repository'], revealInOS)),
		register(
			'copyPath',
			withNode(['repository'], node => vscode.env.clipboard.writeText(node.repository.rootUri.fsPath)),
		),
	]
}
