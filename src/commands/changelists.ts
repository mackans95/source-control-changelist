// Making, renaming, describing and deleting changelists, and moving files between them.
import * as vscode from 'vscode'
import { changesOf, forNodes, paths } from './nodes.ts'
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

/** The commands on changelists, and the ones that move files into and out of them. */
export function changelistCommands(services: Services): CommandTable {
	const { changelists } = services

	return {
		newChangelist: forNodes(['folder', 'group', 'repository', 'resource'], node =>
			newChangelist(node.repository, changelists),
		),
		setActiveChangelist: forNodes(['group'], node => changelists.setActive(node.repository, node.changelist)),
		renameChangelist: forNodes(['group'], node => renameChangelist(node, changelists)),
		editChangelistDescription: forNodes(['group'], node => editDescription(node, changelists)),
		deleteChangelist: forNodes(
			['group'],
			node => node.changelist && changelists.remove(node.repository, node.changelist),
		),
		moveToChangelist: forNodes(['group', 'folder', 'resource'], node => moveToChangelist(services, node)),
		// The view runs it when a file or folder is dropped on a group. It isn't in the menus.
		dropChanges: (source: Node | undefined, target: Node | undefined) =>
			(source?.type === 'folder' || source?.type === 'resource') && target?.type === 'group'
				? dropChanges(services, source, target)
				: undefined,
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

/** Moves files to a changelist picked from a list, which can also make a new one. */
async function moveToChangelist(services: Services, node: GroupNode | FolderNode | ResourceNode): Promise<void> {
	const { repository, changelist } = node
	const target = await pickChangelist(repository, services.changelists, changelist, 'Move to Changelist')

	if (target) {
		await moveChanges(services, repository, changesOf(node), changelist, target.list)
	}
}

/** Drops files on a group: Staged Changes stages them, and any other group moves them there. */
async function dropChanges(services: Services, source: FolderNode | ResourceNode, target: GroupNode): Promise<void> {
	const { repository } = source
	const changes = changesOf(source)

	if (target.kind === 'staged') {
		await stageParts(services, repository, await partsOf(services, repository, changes, source.changelist))
		return
	}

	if (source.kind === 'staged') {
		await repository.revert(paths(changes))
		await services.changelists.update(repository, changelists => moveFiles(changelists, changes, target.changelist))
		return
	}

	// Changes and Untracked Changes have no list, so the files leave theirs.
	await moveChanges(services, repository, changes, source.changelist, target.changelist)
}

/** Asks which changelist to move to, which can also be a new one. Undefined when nothing was picked. */
export async function pickChangelist(
	repository: Repository,
	changelists: ChangelistStore,
	current: string | undefined,
	title: string,
): Promise<{ list: string | undefined } | undefined> {
	const picks = changelistPicks(changelists.get(repository).lists, current)
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

/** The lists Move to Changelist offers: Changes, the other lists, and a new one. */
function changelistPicks(lists: readonly string[], current: string | undefined): ChangelistPick[] {
	return [
		// Only files in a list can go back to Changes. Untracked files go back to Untracked Changes.
		...(current === undefined ? [] : [{ label: GROUP_LABELS.changes, isNew: false }]),
		...lists.filter(list => list !== current).map(list => ({ label: list, changelist: list, isNew: false })),
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
