// Committing a repository's staged changes, or a changelist's files.
import * as vscode from 'vscode'
import { forNodes, paths } from './nodes.ts'
import { changelistOf, groupChanges, unlistedChanges } from '../model/changelists.ts'
import { repositoryName } from '../model/repositories.ts'
import type { ChangelistStore } from '../state/changelistStore.ts'
import type { CommandTable, GroupNode, Services } from '../types/extension.ts'
import type { Repository } from '../types/git.ts'

/** The Commit buttons on repositories and changelists. */
export function commitCommands({ changelists }: Services): CommandTable {
	return {
		commit: forNodes(['repository'], node => commit(node.repository, changelists)),
		commitChangelist: forNodes(['group'], node => commitChangelist(node, changelists)),
	}
}

/** Commits the staged changes, or when nothing is staged, the changes outside the changelists after asking. */
async function commit(repository: Repository, changelists: ChangelistStore): Promise<void> {
	const name = repositoryName(repository)
	const nothingStaged = repository.state.indexChanges.length === 0

	if (nothingStaged && unlistedChanges(repository, changelists.get(repository)).length === 0) {
		void vscode.window.showInformationMessage(
			`Everything in ${name} is in a changelist. Commit it with the changelist's Commit button.`,
		)
		return
	}

	if (nothingStaged && !(await confirmStageAll(repository, changelists))) return

	const message = await askCommitMessage(`Commit to ${name}`, repository.inputBox.value)

	if (!message) return

	// Something may have been staged while the input box was open.
	if (repository.state.indexChanges.length === 0) {
		await stageUnlisted(repository, changelists)
	}

	await commitStaged(repository, message)
}

/** Commits a changelist's files and nothing else, after offering to unstage the other staged files. */
async function commitChangelist(node: GroupNode, changelists: ChangelistStore): Promise<void> {
	const { repository, changelist, changes } = node

	if (changelist === undefined) return

	const lists = changelists.get(repository)
	const staged = repository.state.indexChanges
	const others = staged.filter(c => changelistOf(lists, c) !== changelist)

	if (changes.length === 0 && staged.length === others.length) {
		void vscode.window.showInformationMessage(`There is nothing to commit in ${changelist}.`)
		return
	}

	if (others.length > 0 && !(await confirmUnstageOthers(changelist, others.length))) return

	// The list's description is the message it suggests.
	const message = await askCommitMessage(
		`Commit ${changelist} to ${repositoryName(repository)}`,
		lists.descriptions?.[changelist] || repository.inputBox.value || changelist,
	)

	if (!message) return

	// The Git API commits what's staged, so only the list's files may be.
	if (others.length > 0) {
		await repository.revert(paths(others))
	}

	if (changes.length > 0) {
		await repository.add(paths(changes))
	}

	await commitStaged(repository, message)

	if (
		deletesAfterCommit() &&
		groupChanges(repository, 'changes', changelists.get(repository), changelist).length === 0
	) {
		await changelists.remove(repository, changelist)
	}
}

/** Asks whether to stage the changes outside the changelists, when nothing is staged. */
async function confirmStageAll(repository: Repository, changelists: ChangelistStore): Promise<boolean> {
	const what =
		changelists.get(repository).lists.length > 0 ? "the changes that aren't in a changelist" : 'all changes'
	const choice = await vscode.window.showWarningMessage(
		`There are no staged changes in ${repositoryName(repository)}. Stage ${what} and commit them?`,
		{ modal: true },
		'Stage All & Commit',
	)

	return choice === 'Stage All & Commit'
}

/** Asks whether to unstage the staged files that aren't in the changelist. */
async function confirmUnstageOthers(changelist: string, others: number): Promise<boolean> {
	const which = others === 1 ? "1 staged file isn't" : `${others} staged files aren't`
	const choice = await vscode.window.showWarningMessage(
		`${which} in ${changelist}. Unstage the other files and commit only ${changelist}?`,
		{ modal: true },
		'Unstage & Commit',
	)

	return choice === 'Unstage & Commit'
}

/** Asks for the commit message, starting from `value`. */
function askCommitMessage(title: string, value: string): Thenable<string | undefined> {
	return vscode.window.showInputBox({
		title,
		prompt: 'Commit message',
		value,
		validateInput: message => (message.trim() ? undefined : 'Please provide a commit message'),
	})
}

/** Stages the changes outside the changelists. */
async function stageUnlisted(repository: Repository, changelists: ChangelistStore): Promise<void> {
	const changes = unlistedChanges(repository, changelists.get(repository))

	// The Git API's add with no paths would stage everything.
	if (changes.length > 0) {
		await repository.add(paths(changes))
	}
}

/** Commits what's staged, and empties the Source Control input box the message may have come from. */
async function commitStaged(repository: Repository, message: string): Promise<void> {
	await repository.commit(message)
	repository.inputBox.value = ''
}

/** The `changelist.deleteChangelistsAfterCommit` setting: whether a list goes once its commit has emptied it. */
function deletesAfterCommit(): boolean {
	return vscode.workspace.getConfiguration('changelist').get<boolean>('deleteChangelistsAfterCommit', false)
}
