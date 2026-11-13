// Committing a repository's staged changes, or a changelist's files.
import * as vscode from 'vscode'
import { forNodes, paths } from './nodes.ts'
import { repositoryName } from '../model/repositories.ts'
import { partsOf, stagedOutside, stageParts } from './parts.ts'
import { changelistOf, groupChanges, listsOf, unlistedChanges } from '#model/changelists.ts'
import type { ChangelistStore } from '#state/changelistStore.ts'
import type { CommandTable, GroupNode, Services } from '#types/extension.ts'
import type { Repository } from '#types/git.ts'

/** The Commit buttons on repositories and changelists. */
export function commitCommands(services: Services): CommandTable {
	return {
		commit: forNodes(['repository'], node => commit(services, node.repository)),
		commitChangelist: forNodes(['group'], node => commitChangelist(services, node)),
	}
}

/** Commits the staged changes, or when nothing is staged, the changes outside the changelists after asking. */
async function commit(services: Services, repository: Repository): Promise<void> {
	const { changelists } = services
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
		await stageUnlisted(services, repository)
	}

	await commitStaged(repository, message)
}

/** Commits a changelist's files and nothing else, after offering to unstage the other staged files. */
async function commitChangelist(services: Services, node: GroupNode): Promise<void> {
	const { changelists, hunks } = services
	const { repository, changelist, changes } = node

	if (changelist === undefined) return

	const lists = changelists.get(repository)
	const staged = repository.state.indexChanges
	// A fully staged split file is only in Staged Changes, but its part in the list is still the list's.
	const inGroup = new Set(changes.map(c => c.uri.toString()))
	const stagedSplit = staged.filter(
		c =>
			lists.hunks?.[c.uri.toString()] && listsOf(lists, c).includes(changelist) && !inGroup.has(c.uri.toString()),
	)
	const parts = await partsOf(services, repository, [...changes, ...stagedSplit], changelist)
	const split = new Set(parts.split.map(part => part.change.uri.toString()))
	// What's staged and isn't the list's: other files, and other lists' changes in split files.
	const others = [
		...staged.filter(c => !split.has(c.uri.toString()) && changelistOf(lists, c) !== changelist),
		...(await stagedOutside(services, repository, parts.split)),
	]
	const listed = parts.whole.length + parts.split.length

	if (listed === 0 && staged.length === others.length) {
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

	// The Git API commits what's staged, so only the list's files and changes may be. A split file is
	// unstaged too, so only its changes in the list are staged again.
	const unstaging = [...others, ...parts.split.map(part => part.change)]

	if (unstaging.length > 0) {
		await repository.revert(paths(unstaging))
	}

	await stageParts(services, repository, parts)
	await commitStaged(repository, message)
	// The list's committed changes aren't changes any more, which shows once they're read again.
	await hunks.track(repository)

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

/** Asks whether to unstage the staged changes that aren't in the changelist. */
async function confirmUnstageOthers(changelist: string, others: number): Promise<boolean> {
	const which = others === 1 ? '1 staged file has changes' : `${others} staged files have changes`
	const choice = await vscode.window.showWarningMessage(
		`${which} that aren't in ${changelist}. Unstage them and commit only ${changelist}?`,
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

/** Stages the changes outside the changelists, and split files' changes in Changes. */
async function stageUnlisted(services: Services, repository: Repository): Promise<void> {
	const changes = unlistedChanges(repository, services.changelists.get(repository))
	await stageParts(services, repository, await partsOf(services, repository, changes, undefined))
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
