// Making, renaming, describing and deleting changelists, and moving files between them.
import * as vscode from 'vscode'
import { changesOf, forNodes, paths } from './nodes.ts'
import { GROUP_LABELS } from '../model/changes.ts'
import { repositoryName } from '../model/repositories.ts'
import type { ChangelistStore } from '../state/changelistStore.ts'
import type {
	ChangelistPick,
	CommandTable,
	FolderNode,
	GroupNode,
	Node,
	ResourceNode,
	Services,
} from '../types/extension.ts'
import type { Repository } from '../types/git.ts'

/** The commands on changelists, and the ones that move files into and out of them. */
export function changelistCommands({ changelists }: Services): CommandTable {
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
		moveToChangelist: forNodes(['group', 'folder', 'resource'], node => moveToChangelist(node, changelists)),
		// The view runs it when a file or folder is dropped on a group. It isn't in the menus.
		dropChanges: (source: Node | undefined, target: Node | undefined) =>
			(source?.type === 'folder' || source?.type === 'resource') && target?.type === 'group'
				? dropChanges(source, target, changelists)
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
async function moveToChangelist(
	node: GroupNode | FolderNode | ResourceNode,
	changelists: ChangelistStore,
): Promise<void> {
	const { repository } = node
	const pick = await vscode.window.showQuickPick(changelistPicks(node, changelists), {
		title: 'Move to Changelist',
		placeHolder: 'Changelist',
	})

	if (!pick) return

	const target = pick.isNew ? await newChangelist(repository, changelists) : pick.changelist

	if (pick.isNew && !target) return

	await changelists.move(repository, changesOf(node), target)
}

/** Drops files on a group: Staged Changes stages them, and any other group moves them there. */
async function dropChanges(
	source: FolderNode | ResourceNode,
	target: GroupNode,
	changelists: ChangelistStore,
): Promise<void> {
	const { repository } = source
	const changes = changesOf(source)

	if (target.kind === 'staged') {
		await repository.add(paths(changes))
		return
	}

	if (source.kind === 'staged') {
		await repository.revert(paths(changes))
	}

	// Changes and Untracked Changes have no list, so the files leave theirs.
	await changelists.move(repository, changes, target.changelist)
}

/** The lists Move to Changelist offers: Changes, the other lists, and a new one. */
function changelistPicks(node: GroupNode | FolderNode | ResourceNode, changelists: ChangelistStore): ChangelistPick[] {
	const { repository, changelist } = node
	const others = changelists.get(repository).lists.filter(list => list !== changelist)

	return [
		// Only files in a list can go back to Changes. Untracked files go back to Untracked Changes.
		...(changelist === undefined ? [] : [{ label: GROUP_LABELS.changes, isNew: false }]),
		...others.map(list => ({ label: list, changelist: list, isNew: false })),
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
