// The rows for each repository, its groups, and their folders and files, with their buttons.
import { run } from './api.ts'
import { collapsedRows } from './collapse.ts'
import { button, codicon, span } from './dom.ts'
import { fileIcon } from './icons.ts'
import { tree } from './tree.ts'
import type {
	ActionTarget,
	ChangeCategory,
	ChangeCounts,
	FileItem,
	FolderItem,
	GroupItem,
	MenuContext,
	RepositoryItem,
	RowSection,
	WebviewAction,
} from '../types/shared.ts'
import type { CategoryDisplay } from '../types/webview.ts'

// In the order they're shown on the repository's row.
const CATEGORIES: Record<ChangeCategory, CategoryDisplay> = {
	added: { icon: 'diff-added', label: 'added', color: '--vscode-gitDecoration-addedResourceForeground' },
	modified: { icon: 'diff-modified', label: 'modified', color: '--vscode-gitDecoration-modifiedResourceForeground' },
	deleted: { icon: 'diff-removed', label: 'deleted', color: '--vscode-gitDecoration-deletedResourceForeground' },
	conflict: {
		icon: 'warning',
		label: 'with conflicts',
		color: '--vscode-gitDecoration-conflictingResourceForeground',
	},
}

/** An icon button that runs a command on the row's target. */
function actionButton(icon: string, title: string, action: WebviewAction, target: ActionTarget): HTMLButtonElement {
	return button(`action codicon codicon-${icon}`, title, () => run(action, target))
}

/** A button with an icon and text, like the branch on a repository's row. */
function textButton(
	icon: string,
	text: string,
	title: string,
	action: WebviewAction,
	target: ActionTarget,
): HTMLButtonElement {
	const element = button('text-button', title, () => run(action, target))
	element.append(codicon(icon, 'text-button-icon'), span('text-button-label', text))
	return element
}

/**
 * A row, added to `rows`, with its right-click menu context. The tree notes its parent and what
 * clicking it does.
 */
function createRow(
	rows: HTMLElement[],
	id: string,
	level: number,
	section: RowSection,
	target: ActionTarget,
	parentId: string | undefined,
	onActivate: () => void,
): HTMLDivElement {
	const row = document.createElement('div')
	row.className = `row ${section}`
	row.dataset.id = id
	const context: MenuContext = { webviewSection: section, preventDefaultContextMenuItems: true, ...target }
	row.dataset.vscodeContext = JSON.stringify(context)
	row.tabIndex = -1
	row.setAttribute('role', 'treeitem')
	row.setAttribute('aria-level', String(level))
	row.style.setProperty('--level', String(level - 1))
	tree.addRow(id, parentId, onActivate)
	rows.push(row)
	return row
}

/** Adds the arrow, and returns whether the row is expanded. */
function addTwistie(row: HTMLDivElement, id: string): boolean {
	const expanded = !collapsedRows.has(id)
	collapsedRows.addCollapsible(id)
	row.setAttribute('aria-expanded', String(expanded))
	row.append(codicon(expanded ? 'chevron-down' : 'chevron-right', 'twistie'))
	return expanded
}

/** The colored counts on a repository's row, with a tooltip that spells them out. */
function countsElement(counts: ChangeCounts): HTMLSpanElement {
	const element = span('counts')
	const descriptions: string[] = []
	for (const category of Object.keys(CATEGORIES) as ChangeCategory[]) {
		if (counts[category] > 0) {
			const { icon, label, color } = CATEGORIES[category]
			const count = span('count')
			count.style.setProperty('color', `var(${color})`)
			count.append(codicon(icon, 'count-icon'), span('count-number', String(counts[category])))
			element.append(count)
			descriptions.push(`${counts[category]} ${label}`)
		}
	}
	element.dataset.tooltip = descriptions.join(', ')
	return element
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

/** A file's row: its icon, its name, its folder in list mode, its status letter and its actions. */
function renderFile(
	rows: HTMLElement[],
	repository: RepositoryItem,
	group: GroupItem,
	file: FileItem,
	level: number,
	parentId: string,
): void {
	const target: ActionTarget = { repository: repository.id, kind: group.kind, uri: file.uri }
	const row = createRow(rows, file.id, level, 'file', target, parentId, () => run('openChange', target))
	row.dataset.tooltip = file.tooltip
	row.style.setProperty('--decoration-color', `var(${file.color})`)
	if (file.strikethrough) {
		row.classList.add('strikethrough')
	}

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

	row.append(span('twistie'))
	if (file.icon) {
		row.append(fileIcon(file.icon))
	}
	row.append(span('label', file.name))

	if (file.folder) {
		row.append(span('description', file.folder))
	}
	row.append(span('spacer'), actions, span('letter', file.letter))
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
	const target: ActionTarget = { repository: repository.id, kind: group.kind, uri: folder.uri }
	const row = createRow(rows, folder.id, level, 'folder', target, parentId, () => tree.toggle(folder.id))
	const expanded = addTwistie(row, folder.id)
	const actions = groupActions(group, target)
	const icon = expanded ? folder.expandedIcon : folder.icon

	if (icon) {
		row.append(fileIcon(icon))
	}

	row.append(span('label', folder.label), span('spacer'), actions)

	if (expanded) {
		renderEntries(rows, repository, group, folder.children, level + 1, folder.id)
	}
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

/** A group's row, and the rows below it while it's expanded. */
function renderGroup(rows: HTMLElement[], repository: RepositoryItem, group: GroupItem): void {
	const target: ActionTarget = { repository: repository.id, kind: group.kind }
	const row = createRow(rows, group.id, 2, 'group', target, repository.id, () => tree.toggle(group.id))
	const expanded = addTwistie(row, group.id)
	const actions = groupActions(group, target)

	row.append(span('label', group.label), span('spacer'), actions, span('badge', String(group.count)))

	if (expanded) {
		renderEntries(rows, repository, group, group.children, 3, group.id)
	}
}

/** A repository's row, and the rows below it while it's expanded. */
export function renderRepository(rows: HTMLElement[], repository: RepositoryItem): void {
	const target: ActionTarget = { repository: repository.id }
	const row = createRow(rows, repository.id, 1, 'repository', target, undefined, () => tree.toggle(repository.id))
	const expanded = addTwistie(row, repository.id)
	row.dataset.tooltip = repository.path

	const toolbar = span('toolbar')

	if (repository.branch) {
		toolbar.append(
			textButton('git-branch', repository.branch, `${repository.branch}, Switch Branch...`, 'checkout', target),
		)
	}

	const actions = span('actions')
	actions.append(
		actionButton('check', 'Commit', 'commit', target),
		actionButton('add', 'Stage All Changes', 'stageAll', target),
	)

	row.append(
		codicon('repo'),
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
