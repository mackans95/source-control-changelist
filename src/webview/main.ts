// Renders the Changelist view in its webview. The extension sends the repositories with changes;
// this draws them as a tree that looks and behaves like VS Code's own, and sends clicks back as
// actions. It keeps which rows are collapsed, also while the view is hidden.
import type { CategoryDisplay, ChangeCategory, ChangeCounts } from '../types/shared'
import type {
	ActionTarget,
	ExtensionMessage,
	FileItem,
	FolderItem,
	GroupItem,
	RepositoryItem,
	WebviewAction,
} from '../types/webview'

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

const vscode = acquireVsCodeApi()
const root = document.getElementById('root')!

let repositories: readonly RepositoryItem[] = []
const collapsed = new Set(vscode.getState()?.collapsed ?? [])
// The row that has the keyboard focus, or had it last.
let focusedId: string | undefined
let lastAllCollapsed: boolean | undefined

// Filled in on each render.
let collapsibleIds: string[] = []
const parents = new Map<string, string>()
const activations = new Map<string, () => void>()

function run(action: WebviewAction, target: ActionTarget): void {
	vscode.postMessage({ type: 'run', action, target })
}

function saveState(): void {
	vscode.setState({ collapsed: [...collapsed] })
}

function toggle(id: string): void {
	if (collapsed.has(id)) {
		collapsed.delete(id)
	} else {
		collapsed.add(id)
	}
	saveState()
	render()
}

function setAllExpanded(expanded: boolean): void {
	collapsed.clear()
	if (!expanded) {
		collapsibleIds.forEach(id => collapsed.add(id))
	}
	saveState()
	render()
}

/** Tells the extension whether every repository is collapsed, which picks the Collapse All or Expand All button. */
function reportAllCollapsed(): void {
	const allCollapsed = repositories.length > 0 && repositories.every(r => collapsed.has(r.id))
	if (allCollapsed !== lastAllCollapsed) {
		lastAllCollapsed = allCollapsed
		vscode.postMessage({ type: 'allCollapsed', value: allCollapsed })
	}
}

function span(className: string, text?: string): HTMLSpanElement {
	const element = document.createElement('span')
	element.className = className
	if (text !== undefined) {
		element.textContent = text
	}
	return element
}

function codicon(name: string, className = 'icon'): HTMLSpanElement {
	return span(`${className} codicon codicon-${name}`)
}

function button(className: string, title: string, onClick: () => void): HTMLButtonElement {
	const element = document.createElement('button')
	element.className = className
	element.title = title
	element.setAttribute('aria-label', title)
	// Like the inline actions in VS Code's trees: reached with the mouse, not with Tab.
	element.tabIndex = -1
	element.addEventListener('click', event => {
		event.stopPropagation()
		onClick()
	})
	return element
}

function actionButton(icon: string, title: string, action: WebviewAction, target: ActionTarget): HTMLButtonElement {
	return button(`action codicon codicon-${icon}`, title, () => run(action, target))
}

function textButton(
	icon: string,
	text: string,
	title: string,
	action: WebviewAction,
	target: ActionTarget,
): HTMLButtonElement {
	const element = button('text-button', title, () => run(action, target))
	element.append(codicon(icon, 'text-button-icon'))
	if (text) {
		element.append(span('text-button-label', text))
	}
	return element
}

function createRow(
	rows: HTMLElement[],
	id: string,
	level: number,
	className: string,
	parentId: string | undefined,
	onActivate: () => void,
): HTMLDivElement {
	const row = document.createElement('div')
	row.className = `row ${className}`
	row.dataset.id = id
	row.tabIndex = -1
	row.setAttribute('role', 'treeitem')
	row.setAttribute('aria-level', String(level))
	row.style.setProperty('--level', String(level - 1))
	if (parentId) {
		parents.set(id, parentId)
	}
	activations.set(id, onActivate)
	rows.push(row)
	return row
}

/** Adds the arrow, and returns whether the row is expanded. */
function addTwistie(row: HTMLDivElement, id: string): boolean {
	const expanded = !collapsed.has(id)
	collapsibleIds.push(id)
	row.setAttribute('aria-expanded', String(expanded))
	row.append(codicon(expanded ? 'chevron-down' : 'chevron-right', 'twistie'))
	return expanded
}

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
	element.title = descriptions.join(', ')
	return element
}

function syncText(repository: RepositoryItem): string {
	return [repository.behind ? `${repository.behind}↓` : '', repository.ahead ? `${repository.ahead}↑` : '']
		.filter(Boolean)
		.join(' ')
}

function renderRepository(rows: HTMLElement[], repository: RepositoryItem): void {
	const target: ActionTarget = { repository: repository.id }
	const row = createRow(rows, repository.id, 1, 'repository', undefined, () => toggle(repository.id))
	const expanded = addTwistie(row, repository.id)
	row.title = repository.path

	const toolbar = span('toolbar')
	if (repository.branch) {
		toolbar.append(
			textButton('git-branch', repository.branch, `${repository.branch}, Switch Branch...`, 'checkout', target),
		)
	}
	if (repository.sync === 'tracking') {
		toolbar.append(textButton('sync', syncText(repository), 'Sync Changes', 'sync', target))
	} else if (repository.sync === 'unpublished') {
		toolbar.append(textButton('cloud-upload', '', 'Publish Branch', 'publish', target))
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

function renderGroup(rows: HTMLElement[], repository: RepositoryItem, group: GroupItem): void {
	const target: ActionTarget = { repository: repository.id, kind: group.kind }
	const row = createRow(rows, group.id, 2, 'group', repository.id, () => toggle(group.id))
	const expanded = addTwistie(row, group.id)

	const actions = span('actions')
	actions.append(
		group.kind === 'staged'
			? actionButton('remove', 'Unstage All Changes', 'unstageAll', target)
			: actionButton('add', 'Stage All Changes', 'stageAll', target),
	)
	row.append(span('label', group.label), span('spacer'), actions, span('badge', String(group.count)))

	if (expanded) {
		renderEntries(rows, repository, group, group.children, 3, group.id)
	}
}

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

function renderFolder(
	rows: HTMLElement[],
	repository: RepositoryItem,
	group: GroupItem,
	folder: FolderItem,
	level: number,
	parentId: string,
): void {
	const target: ActionTarget = { repository: repository.id, kind: group.kind, uri: folder.uri }
	const row = createRow(rows, folder.id, level, 'folder', parentId, () => toggle(folder.id))
	const expanded = addTwistie(row, folder.id)

	const actions = span('actions')
	actions.append(
		group.kind === 'staged'
			? actionButton('remove', 'Unstage All Changes', 'unstageAll', target)
			: actionButton('add', 'Stage All Changes', 'stageAll', target),
	)
	row.append(codicon(expanded ? 'folder-opened' : 'folder'), span('label', folder.label), span('spacer'), actions)

	if (expanded) {
		renderEntries(rows, repository, group, folder.children, level + 1, folder.id)
	}
}

function renderFile(
	rows: HTMLElement[],
	repository: RepositoryItem,
	group: GroupItem,
	file: FileItem,
	level: number,
	parentId: string,
): void {
	const target: ActionTarget = { repository: repository.id, kind: group.kind, uri: file.uri }
	const row = createRow(rows, file.id, level, 'file', parentId, () => run('openChange', target))
	row.title = file.tooltip
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

	row.append(span('twistie'), codicon('file'), span('label', file.name))
	if (file.folder) {
		row.append(span('description', file.folder))
	}
	row.append(span('spacer'), actions, span('letter', file.letter))
}

/**
 * Marks the repository rows whose name has shrunk as far as it can, without and with their
 * actions, so the branch and sync labels shrink too (see styles.css). CSS alone would shrink the
 * name and the labels at the same time.
 */
function fitRepositoryRows(): void {
	for (const row of root.querySelectorAll<HTMLElement>('.row.repository')) {
		row.classList.remove('narrow', 'narrow-with-actions')
		const narrow = row.scrollWidth > row.clientWidth
		row.classList.add('measuring')
		const narrowWithActions = row.scrollWidth > row.clientWidth
		row.classList.remove('measuring')
		row.classList.toggle('narrow', narrow)
		row.classList.toggle('narrow-with-actions', narrowWithActions)
	}
}

function render(): void {
	const hadFocus = root.contains(document.activeElement)
	const rows: HTMLElement[] = []
	collapsibleIds = []
	parents.clear()
	activations.clear()

	for (const repository of repositories) {
		renderRepository(rows, repository)
	}

	if (rows.length === 0) {
		root.replaceChildren(span('empty', 'No changes in any repository.'))
		focusedId = undefined
	} else {
		root.replaceChildren(...rows)
		const focused = rows.find(row => row.dataset.id === focusedId) ?? rows[0]
		setFocus(focused, hadFocus)
		fitRepositoryRows()
	}
	reportAllCollapsed()
}

function rowElements(): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('.row')]
}

function findRow(id: string | undefined): HTMLElement | undefined {
	return rowElements().find(row => row.dataset.id === id)
}

/** Moves the selection to a row. Only that row is reachable with Tab, like in VS Code's trees. */
function setFocus(row: HTMLElement | undefined, focus = true): void {
	if (!row) {
		return
	}
	for (const other of rowElements()) {
		other.tabIndex = -1
		other.classList.remove('focused')
	}
	row.tabIndex = 0
	row.classList.add('focused')
	focusedId = row.dataset.id
	if (focus) {
		row.focus({ preventScroll: true })
		row.scrollIntoView({ block: 'nearest' })
	}
}

root.addEventListener('click', event => {
	const row = (event.target as HTMLElement).closest<HTMLElement>('.row')
	if (row?.dataset.id) {
		setFocus(row)
		activations.get(row.dataset.id)?.()
	}
})

root.addEventListener('keydown', event => {
	const rows = rowElements()
	const index = rows.findIndex(row => row.dataset.id === focusedId)
	const row = rows[index]
	if (!row?.dataset.id) {
		return
	}
	const id = row.dataset.id
	const expanded = row.getAttribute('aria-expanded')

	switch (event.key) {
		case 'ArrowDown':
			setFocus(rows[index + 1])
			break
		case 'ArrowUp':
			setFocus(rows[index - 1])
			break
		case 'Home':
			setFocus(rows[0])
			break
		case 'End':
			setFocus(rows[rows.length - 1])
			break
		case 'ArrowRight':
			if (expanded === 'false') {
				toggle(id)
			} else if (expanded === 'true') {
				setFocus(rows[index + 1])
			}
			break
		case 'ArrowLeft':
			if (expanded === 'true') {
				toggle(id)
			} else {
				setFocus(findRow(parents.get(id)))
			}
			break
		case 'Enter':
		case ' ':
			activations.get(id)?.()
			break
		default:
			return
	}
	event.preventDefault()
})

window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
	const message = event.data
	switch (message.type) {
		case 'update':
			repositories = message.repositories
			render()
			break
		case 'setAllExpanded':
			setAllExpanded(message.expanded)
			break
	}
})

new ResizeObserver(fitRepositoryRows).observe(root)

vscode.postMessage({ type: 'ready' })
