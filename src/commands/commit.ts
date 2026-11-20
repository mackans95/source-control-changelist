// Committing a repository's staged changes, or a changelist's files, and amending the last commit with
// them, or pushing after.
import * as vscode from 'vscode'
import { forNodes, paths } from './nodes.ts'
import { repositoryName } from '#model/repositories.ts'
import { partsOf, stagedOutside, stageParts } from './parts.ts'
import { publish } from './repositories.ts'
import { changelistOf, groupChanges, listsOf, unlistedChanges } from '#model/changelists.ts'
import type { ChangelistStore } from '#state/changelistStore.ts'
import type { CommandTable, CommitKind, GroupNode, Services } from '#types/extension.ts'
import type { Commit, Repository } from '#types/git.ts'

/** The Commit buttons on repositories and changelists, and their Commit (Amend) and Commit & Push. */
export function commitCommands(services: Services): CommandTable {
	const repositoryCommit = (kind: CommitKind) =>
		forNodes(['repository'], node => commit(services, node.repository, kind))
	const changelistCommit = (kind: CommitKind) => forNodes(['group'], node => commitChangelist(services, node, kind))

	return {
		commit: repositoryCommit('commit'),
		commitAmend: repositoryCommit('amend'),
		commitAndPush: repositoryCommit('push'),
		commitChangelist: changelistCommit('commit'),
		commitChangelistAmend: changelistCommit('amend'),
		commitChangelistAndPush: changelistCommit('push'),
	}
}

/** Commits the staged changes, or when nothing is staged, the changes outside the changelists after asking. */
async function commit(services: Services, repository: Repository, kind: CommitKind): Promise<void> {
	if (kind === 'amend') return amend(repository)

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

	await commitStaged(repository, message, kind)

	if (kind === 'push') {
		await push(services, repository)
	}
}

/** Amends the last commit with what's staged, or changes only its message when nothing is. */
async function amend(repository: Repository): Promise<void> {
	const last = await lastCommit(repository)

	if (!last || !(await confirmAmendPushed(repository))) return

	const message = await askAmendMessage(
		`Amend the Last Commit in ${repositoryName(repository)}`,
		last,
		repository.state.indexChanges.length === 0,
	)

	if (message) {
		await commitStaged(repository, message, 'amend')
	}
}

/** Commits a changelist's files and nothing else, after offering to unstage the other staged files. */
async function commitChangelist(services: Services, node: GroupNode, kind: CommitKind): Promise<void> {
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

	const last = kind === 'amend' ? await lastCommit(repository) : undefined

	if (kind === 'amend' && (!last || !(await confirmAmendPushed(repository)))) return
	if (others.length > 0 && !(await confirmUnstageOthers(changelist, others.length))) return

	// The list's description is the message it suggests.
	const message = last
		? await askAmendMessage(
				`Amend the Last Commit in ${repositoryName(repository)} with ${changelist}`,
				last,
				false,
			)
		: await askCommitMessage(
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
	await commitStaged(repository, message, kind)
	// The list's committed changes aren't changes any more, which shows once they're read again.
	await hunks.track(repository)

	if (
		deletesAfterCommit() &&
		groupChanges(repository, 'changes', changelists.get(repository), changelist).length === 0
	) {
		await changelists.remove(repository, changelist)
	}

	if (kind === 'push') {
		await push(services, repository)
	}
}

/** The commit Amend changes, or undefined after saying there's none yet. */
async function lastCommit(repository: Repository): Promise<Commit | undefined> {
	// HEAD itself, which a commit made outside VS Code can have moved since Git's last check.
	if (repository.state.HEAD?.commit) return repository.getCommit('HEAD')

	void vscode.window.showInformationMessage(`There is no commit to amend in ${repositoryName(repository)}.`)

	return undefined
}

/** Asks before amending a commit that's pushed already, which then needs a force push. True when it isn't pushed. */
async function confirmAmendPushed(repository: Repository): Promise<boolean> {
	const head = repository.state.HEAD

	// Without an upstream, there's nothing to tell it's pushed. With commits to push, the last one isn't.
	if (!head?.upstream || (head.ahead ?? 0) > 0) return true

	const { remote, name } = head.upstream
	const choice = await vscode.window.showWarningMessage(
		`The last commit in ${repositoryName(repository)} is pushed to ${remote}/${name} already. Amending it means you'll have to force push. Amend it anyway?`,
		{ modal: true },
		'Amend',
	)

	return choice === 'Amend'
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
function askCommitMessage(title: string, value: string, prompt = 'Commit message'): Thenable<string | undefined> {
	return vscode.window.showInputBox({
		title,
		prompt,
		value,
		validateInput: message => (message.trim() ? undefined : 'Please provide a commit message'),
	})
}

/** Asks for the last commit's new message, starting from its own. `onlyMessage` says when nothing else changes. */
async function askAmendMessage(title: string, last: Commit, onlyMessage: boolean): Promise<string | undefined> {
	// The input box has one line, so it has the first line, and a longer message keeps its other lines.
	const [subject, ...body] = last.message.split('\n')
	const prompt = [
		body.length > 0 ? "The commit message's first line. The lines after it stay." : 'Commit message.',
		onlyMessage ? 'Nothing is staged, so only the message changes.' : '',
	]
	const message = await askCommitMessage(title, subject, prompt.join(' ').trim())

	return message && [message, ...body].join('\n')
}

/** Stages the changes outside the changelists, and split files' changes in Changes. */
async function stageUnlisted(services: Services, repository: Repository): Promise<void> {
	const changes = unlistedChanges(repository, services.changelists.get(repository))
	await stageParts(services, repository, await partsOf(services, repository, changes, undefined))
}

/** Commits what's staged, or amends the last commit with it, and empties the input box a new commit's message may have come from. */
async function commitStaged(repository: Repository, message: string, kind: CommitKind): Promise<void> {
	await repository.commit(message, { amend: kind === 'amend' })

	// Amend suggests the last commit's message, so a message being written there stays.
	if (kind !== 'amend') {
		repository.inputBox.value = ''
	}
}

/** Pushes after Commit & Push, or offers to publish a branch that isn't on a remote yet. */
async function push({ operations }: Services, repository: Repository): Promise<void> {
	const head = repository.state.HEAD

	if (head?.upstream) {
		await operations.runSingle('push', repository, r => r.push())
		return
	}

	if (!head?.name) {
		void vscode.window.showInformationMessage(
			`${repositoryName(repository)} isn't on a branch, so the commit isn't pushed.`,
		)
		return
	}

	const choice = await vscode.window.showWarningMessage(
		`The branch ${head.name} has no upstream branch. Publish it?`,
		{ modal: true },
		'Publish Branch',
	)

	if (choice === 'Publish Branch') {
		await publish({ type: 'repository', repository }, operations)
	}
}

/** The `changelist.deleteChangelistsAfterCommit` setting: whether a list goes once its commit has emptied it. */
function deletesAfterCommit(): boolean {
	return vscode.workspace.getConfiguration('changelist').get<boolean>('deleteChangelistsAfterCommit', false)
}
