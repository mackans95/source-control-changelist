// The changes' rows: each repository, its groups and changelists, and their folders and files.
import { actionButton, addTwistie, branchButton, createRow, repositoryIcon, repositoryTooltip } from './common.ts'
import { themeColor } from '#helpers/shared.ts'
import { run } from '#webview/api.ts'
import { codicon, span } from '#webview/dom.ts'
import { fileIcon } from '#webview/icons.ts'
import { tree } from '#webview/tree.ts'
import type {
	ActionTarget,
	ChangeCategory,
	ChangeCounts,
	FileItem,
	FolderItem,
	GroupItem,
	RepositoryItem,
} from '#types/shared.ts'
import type { CategoryDisplay } from '#types/webview.ts'

// In the order they're shown on the repository's row.
const CATEGORIES: Record<ChangeCategory, CategoryDisplay> = {
	added: { icon: 'diff-added', label: 'added', color: 'gitDecoration.addedResourceForeground' },
	modified: { icon: 'diff-modified', label: 'modified', color: 'gitDecoration.modifiedResourceForeground' },
	deleted: { icon: 'diff-removed', label: 'deleted', color: 'gitDecoration.deletedResourceForeground' },
	conflict: {
		icon: 'warning',
		label: 'with conflicts',
		color: 'gitDecoration.conflictingResourceForeground',
	},
}

// Staged Changes is green, like `git status` shows staged files, so it's clear which group is shown.
const STAGED_COLOR = 'gitDecoration.addedResourceForeground'

/** A repository's row, and the rows below it while it's expanded. */
export function renderRepository(rows: HTMLElement[], repository: RepositoryItem): void {
	const target: ActionTarget = { repository: repository.id }
	const row = createRow(rows, repository.id, 1, 'repository', target, undefined, () => tree.toggle(repository.id))
	const expanded = addTwistie(row, repository.id)
	row.dataset.tooltip = repositoryTooltip(repository)

	const toolbar = span('toolbar')

	if (repository.branch) {
		toolbar.append(branchButton(repository.branch, target))
	}

	const actions = span('actions')
	actions.append(
		actionButton('check', 'Commit', 'commit', target),
		actionButton('add', 'Stage All Changes', 'stageAll', target),
	)

	row.append(
		repositoryIcon(repository.kind),
		span('label', repository.name),
		countsElement(repository.counts),
		span('spacer'),
		toolbar,
		actions,
	)

	if (expanded) {
		for (const group of repository.groups) {
			renderGroup(rows, repository, group)
		}
	}
}

/** The colored counts on a repository's row, with a tooltip that spells them out. */
function countsElement(counts: ChangeCounts): HTMLSpanElement {
	const element = span('counts')
	const descriptions: string[] = []

	for (const category of Object.keys(CATEGORIES) as ChangeCategory[]) {
		if (counts[category] > 0) {
			const { icon, label, color } = CATEGORIES[category]
			const count = span('count')
			count.style.setProperty('color', themeColor(color))
			count.append(codicon(icon, 'count-icon'), span('count-number', String(counts[category])))
			element.append(count)
			descriptions.push(`${counts[category]} ${label}`)
		}
	}

	element.dataset.tooltip = descriptions.join(', ')
	return element
}

/** A group's or changelist's row, and the rows below it while it's expanded. */
function renderGroup(rows: HTMLElement[], repository: RepositoryItem, group: GroupItem): void {
	const target: ActionTarget = { repository: repository.id, kind: group.kind, changelist: group.changelist }
	const context = { ...target, active: group.active }
	const row = createRow(rows, group.id, 2, 'group', context, repository.id, () => tree.toggle(group.id))
	// Files dropped on a group's row land in the group.
	row.dataset.group = group.id
	const expanded = addTwistie(row, group.id)
	const actions = groupActions(group, target)

	// A changelist commits on its own, like a repository does.
	if (group.changelist !== undefined) {
		actions.prepend(actionButton('check', 'Commit Changelist', 'commitChangelist', target))
	}

	const label = span('label', group.label)

	if (group.kind === 'staged') {
		label.style.setProperty('color', themeColor(STAGED_COLOR))
	}

	// The active changelist is bold, like in PyCharm. Changes isn't, even when no list is active.
	const active = group.active && group.changelist !== undefined
	row.classList.toggle('active-changelist', active)

	const tooltip = groupTooltip(group, active)

	// An empty `data-tooltip` would still show an empty tooltip.
	if (tooltip) {
		row.dataset.tooltip = tooltip
	}

	const description = group.description ? [span('description', group.description)] : []

	row.append(label, ...description, span('spacer'), actions, span('badge', String(group.count)))

	if (expanded) {
		renderEntries(rows, repository, group, group.children, 3, group.id)
	}
}

/** The actions on a group's or folder's row: Discard All when it's unstaged, and Stage or Unstage All. */
function groupActions(group: GroupItem, target: ActionTarget): HTMLSpanElement {
	const actions = span('actions')

	if (group.kind === 'changes' || group.kind === 'untracked') {
		actions.append(actionButton('discard', 'Discard All Changes', 'discardAll', target))
	}

	actions.append(
		group.kind === 'staged'
			? actionButton('remove', 'Unstage All Changes', 'unstageAll', target)
			: actionButton('add', 'Stage All Changes', 'stageAll', target),
	)

	return actions
}

/** A group's tooltip: a changelist's description, and whether it's the active one. */
function groupTooltip(group: GroupItem, active: boolean): string {
	return [group.description, active ? 'Active changelist: new changes go here' : undefined]
		.filter(Boolean)
		.join(' • ')
}

/** The rows for a group's or folder's folders and files. */
function renderEntries(
	rows: HTMLElement[],
	repository: RepositoryItem,
	group: GroupItem,
	entries: readonly (FolderItem | FileItem)[],
	level: number,
	parentId: string,
): void {
	for (const entry of entries) {
		if (entry.type === 'folder') {
			renderFolder(rows, repository, group, entry, level, parentId)
		} else {
			renderFile(rows, repository, group, entry, level, parentId)
		}
	}
}

/** A folder's row, and the rows below it while it's expanded. */
function renderFolder(
	rows: HTMLElement[],
	repository: RepositoryItem,
	group: GroupItem,
	folder: FolderItem,
	level: number,
	parentId: string,
): void {
	const target: ActionTarget = {
		repository: repository.id,
		kind: group.kind,
		changelist: group.changelist,
		uri: folder.uri,
	}
	const row = createRow(rows, folder.id, level, 'folder', target, parentId, () => tree.toggle(folder.id))
	makeDraggable(row, group)
	const expanded = addTwistie(row, folder.id)
	const icon = expanded ? folder.expandedIcon : folder.icon

	if (icon) {
		row.append(fileIcon(icon))
	}

	row.append(span('label', folder.label), span('spacer'), groupActions(group, target))

	if (expanded) {
		renderEntries(rows, repository, group, folder.children, level + 1, folder.id)
	}
}

/** Lets a file's or folder's row be dragged to another group. Merge Changes is Git's own, so its stay. */
function makeDraggable(row: HTMLDivElement, group: GroupItem): void {
	row.dataset.group = group.id
	row.draggable = group.kind !== 'merge'
}

/** A file's row: its icon, its name, its folder in list mode, its status letter and its actions. */
function renderFile(
	rows: HTMLElement[],
	repository: RepositoryItem,
	group: GroupItem,
	file: FileItem,
	level: number,
	parentId: string,
): void {
	const target: ActionTarget = {
		repository: repository.id,
		kind: group.kind,
		changelist: group.changelist,
		uri: file.uri,
	}
	const row = createRow(rows, file.id, level, 'file', target, parentId, () => run('openChange', target))
	makeDraggable(row, group)
	row.dataset.tooltip = file.tooltip
	row.style.setProperty('--decoration-color', file.color)
	row.classList.toggle('strikethrough', file.strikethrough)
	row.append(span('twistie'))

	if (file.icon) {
		row.append(fileIcon(file.icon))
	}

	row.append(span('label', file.name))

	if (file.folder) {
		row.append(span('description', file.folder))
	}

	row.append(span('spacer'), fileActions(group, target), span('letter', file.letter))
}

/** The actions on a file's row: Open File, Discard when it's unstaged, and Stage or Unstage. */
function fileActions(group: GroupItem, target: ActionTarget): HTMLSpanElement {
	const actions = span('actions')
	actions.append(actionButton('go-to-file', 'Open File', 'openFile', target))

	if (group.kind === 'changes' || group.kind === 'untracked') {
		actions.append(actionButton('discard', 'Discard Changes', 'discard', target))
	}

	actions.append(
		group.kind === 'staged'
			? actionButton('remove', 'Unstage Changes', 'unstage', target)
			: actionButton('add', 'Stage Changes', 'stage', target),
	)

	return actions
}
