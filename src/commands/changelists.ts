// Making, renaming, describing and deleting changelists, and moving files between them.
import * as vscode from 'vscode'
import { forNodes, forSelected, groupsOf, paths } from './nodes.ts'
import { GROUP_LABELS } from '#model/changes.ts'
import { hunkLists, moveFiles, moveHunks } from '#model/changelists.ts'
import { repositoryName } from '#model/repositories.ts'
import { partsOf, stageParts } from './parts.ts'
import type { ChangelistStore } from '#state/changelistStore.ts'
import type {
	ChangelistPick,
	CommandTable,
	FolderNode,
	GroupNode,
	Node,
	ResourceNode,
	Services,
} from '#types/extension.ts'
import type { Change, Repository } from '#types/git.ts'
import type { GroupKind } from '#types/shared.ts'

// The rows with files, which Move to Changelist takes the files of.
const FILE_ROWS = ['group', 'folder', 'resource'] as const
// The groups whose files can move to a changelist. Merge Changes is Git's own, and Staged Changes is staged.
const MOVE_KINDS: readonly GroupKind[] = ['changes', 'untracked']
// The groups whose files can be dropped on another group. Merge Changes is Git's own.
const DROP_KINDS: readonly GroupKind[] = ['staged', 'changes', 'untracked']

/** The commands on changelists, and the ones that move files into and out of them. */
export function changelistCommands(services: Services): CommandTable {
	const { changelists } = services

	return {
		newChangelist: forNodes(['folder', 'group', 'repository', 'resource'], node =>
			newChangelist(node.repository, changelists),
		),
		setActiveChangelist: forNodes(['group'], node => changelists.setActive(node.repository, node.changelist)),
		// The status bar's active list runs it.
		pickActiveChangelist: forNodes(['repository'], node => pickActiveChangelist(node.repository, changelists)),
		renameChangelist: forNodes(['group'], node => renameChangelist(node, changelists)),
		editChangelistDescription: forNodes(['group'], node => editDescription(node, changelists)),
		deleteChangelist: forNodes(
			['group'],
			node => node.changelist && changelists.remove(node.repository, node.changelist),
		),
		moveToChangelist: forSelected(FILE_ROWS, nodes => moveToChangelist(services, groupsOf(nodes, MOVE_KINDS))),
		// The view runs it when files or folders are dropped on a group. It isn't in the menus.
		dropChanges: (target: Node | undefined, sources: readonly Node[] = []) => {
			const files = sources.filter(
				(n): n is FolderNode | ResourceNode => n.type === 'folder' || n.type === 'resource',
			)
			return target?.type === 'group' ? dropChanges(services, groupsOf(files, DROP_KINDS), target) : undefined
		},
	}
}

/** Makes an empty changelist, and returns its name. */
async function newChangelist(repository: Repository, changelists: ChangelistStore): Promise<string | undefined> {
	const title = `New Changelist in ${repositoryName(repository)}`
	const name = (await askChangelistName(repository, changelists, title))?.trim()

	if (name) {
		await changelists.add(repository, name)
	}

	return name
}

/** Asks which changelist new changes go to: Changes for none, a list, or a new one. */
async function pickActiveChangelist(repository: Repository, changelists: ChangelistStore): Promise<void> {
	const { lists, active } = changelists.get(repository)
	// The quick pick can't start on the active one, so it says it's active.
	const description = (list: string | undefined) => (list === active ? 'Active' : undefined)
	const picks: ChangelistPick[] = [
		{ label: GROUP_LABELS.changes, description: description(undefined), isNew: false },
		...lists.map(list => ({ label: list, changelist: list, description: description(list), isNew: false })),
		{ label: '$(add) New Changelist...', isNew: true },
	]
	const pick = await vscode.window.showQuickPick(picks, {
		title: `Active Changelist in ${repositoryName(repository)}`,
		placeHolder: 'Where new changes go',
	})

	if (!pick) return

	const list = pick.isNew ? await newChangelist(repository, changelists) : pick.changelist

	if (!pick.isNew || list) {
		await changelists.setActive(repository, list)
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

/** Edits a changelist's description, which its Commit suggests as the commit message. */
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

/** Moves the groups' files to a changelist picked from a list, which can also make a new one, once per repository. */
async function moveToChangelist(services: Services, groups: readonly GroupNode[]): Promise<void> {
	const repositories = new Map(groups.map(group => [group.repository.rootUri.toString(), group.repository]))

	for (const [root, repository] of repositories) {
		const inRepo = groups.filter(group => group.repository.rootUri.toString() === root)
		// The lists differ between repositories, so the question says which one it's for.
		const title =
			repositories.size > 1 ? `Move to Changelist in ${repositoryName(repository)}` : 'Move to Changelist'
		const from = inRepo.map(group => group.changelist)
		const target = await pickChangelist(repository, services.changelists, from, title)

		if (!target) return

		for (const { changes, changelist } of inRepo) {
			await moveChanges(services, repository, changes, changelist, target.list)
		}
	}
}

/** Drops the groups' files on a group: Staged Changes stages them, and any other group moves them there. */
async function dropChanges(services: Services, sources: readonly GroupNode[], target: GroupNode): Promise<void> {
	for (const { repository, kind, changes, changelist } of sources) {
		if (target.kind === 'staged') {
			await stageParts(services, repository, await partsOf(services, repository, changes, changelist))
		} else if (kind === 'staged') {
			await repository.revert(paths(changes))
			await services.changelists.update(repository, lists => moveFiles(lists, changes, target.changelist))
		} else {
			// Changes and Untracked Changes have no list, so the files leave theirs.
			await moveChanges(services, repository, changes, changelist, target.changelist)
		}
	}
}

/** Asks which changelist to move to from the lists in `from`, which can also be a new one. Undefined when nothing was picked. */
export async function pickChangelist(
	repository: Repository,
	changelists: ChangelistStore,
	from: readonly (string | undefined)[],
	title: string,
): Promise<{ list: string | undefined } | undefined> {
	const picks = changelistPicks(changelists.get(repository).lists, from)
	const pick = await vscode.window.showQuickPick(picks, { title, placeHolder: 'Changelist' })

	if (!pick) return undefined

	if (!pick.isNew) return { list: pick.changelist }

	const name = await newChangelist(repository, changelists)
	return name ? { list: name } : undefined
}

/** Moves files out of the `from` list to `to`: whole files, and for a split file its changes in `from`. */
async function moveChanges(
	{ changelists, hunks }: Services,
	repository: Repository,
	changes: readonly Change[],
	from: string | undefined,
	to: string | undefined,
): Promise<void> {
	// Its changes as they are now, so the right ones move.
	await hunks.track(repository)
	const head = repository.state.HEAD?.commit

	await changelists.update(repository, current =>
		changes.reduce((moved, change) => {
			const fileHunks = hunks.get(repository, change.uri)

			if (!head || !fileHunks || !moved.hunks?.[change.uri.toString()]) {
				return moveFiles(moved, [change], to)
			}

			const lists = hunkLists(moved, change, fileHunks, head)
			const inFrom = fileHunks.filter((_, i) => lists[i] === from)
			return moveHunks(moved, change, fileHunks, inFrom, to, head)
		}, current),
	)
}

/** The lists Move to Changelist offers: Changes, the lists that not everything is in already, and a new one. */
function changelistPicks(lists: readonly string[], from: readonly (string | undefined)[]): ChangelistPick[] {
	return [
		// Only files in a list can go back to Changes. Untracked files go back to Untracked Changes.
		...(from.some(list => list !== undefined) ? [{ label: GROUP_LABELS.changes, isNew: false }] : []),
		...lists
			.filter(list => from.some(current => current !== list))
			.map(list => ({ label: list, changelist: list, isNew: false })),
		{ label: '$(add) New Changelist...', isNew: true },
	]
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
