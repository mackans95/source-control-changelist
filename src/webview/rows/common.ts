// What the changes' rows and the Repositories panel's rows are built from: the row itself, its arrow,
// its buttons, and a repository's icon, tooltip and branch.
import { run } from '#webview/api.ts'
import { collapsedRows } from '#webview/collapse.ts'
import { button, codicon, span } from '#webview/dom.ts'
import { tree } from '#webview/tree.ts'
import type {
	ActionTarget,
	MenuContext,
	RepositoryItem,
	RepositoryKind,
	RowContext,
	RowSection,
	SyncRepositoryItem,
	WebviewAction,
} from '#types/shared.ts'

// Each kind of repository's icon, like the built-in Source Control view.
const REPOSITORY_ICONS: Record<RepositoryKind, string> = {
	repository: 'repo',
	worktree: 'worktree',
	submodule: 'archive',
}

/** A row, added to `rows`. The tree notes its parent and what clicking it does. */
export function createRow(
	rows: HTMLElement[],
	id: string,
	level: number,
	section: RowSection,
	context: RowContext,
	parentId: string | undefined,
	onActivate: () => void,
): HTMLDivElement {
	const row = document.createElement('div')
	row.className = `row ${section}`
	row.dataset.id = id
	const menuContext: MenuContext = { webviewSection: section, preventDefaultContextMenuItems: true, ...context }
	row.dataset.vscodeContext = JSON.stringify(menuContext)
	row.tabIndex = -1
	row.setAttribute('role', 'treeitem')
	row.setAttribute('aria-level', String(level))
	row.style.setProperty('--level', String(level - 1))
	tree.addRow(id, parentId, onActivate)
	rows.push(row)
	return row
}

/** Adds the arrow, and returns whether the row is expanded. */
export function addTwistie(row: HTMLDivElement, id: string): boolean {
	const expanded = !collapsedRows.has(id)
	collapsedRows.addCollapsible(id)
	row.setAttribute('aria-expanded', String(expanded))
	row.append(codicon(expanded ? 'chevron-down' : 'chevron-right', 'twistie'))
	return expanded
}

/** An icon button that runs a command on the row's target. */
export function actionButton(
	icon: string,
	title: string,
	action: WebviewAction,
	target: ActionTarget,
): HTMLButtonElement {
	return button(`action codicon codicon-${icon}`, title, () => run(action, target))
}

/** A button with an icon and text, like the branch on a repository's row. */
export function textButton(
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

/** A repository row's icon, for a repository of its own, a worktree or a submodule. */
export function repositoryIcon(kind: RepositoryKind): HTMLSpanElement {
	return codicon(REPOSITORY_ICONS[kind])
}

/** A repository row's tooltip: its folder, and for a worktree the repository it belongs to. */
export function repositoryTooltip(repository: RepositoryItem | SyncRepositoryItem): string {
	return repository.worktreeOf ? `${repository.path} • Worktree of ${repository.worktreeOf}` : repository.path
}

/** The branch on a repository's row, which switches branch. Its tooltip can say which is the default. */
export function branchButton(branch: string, target: ActionTarget, defaultBranch?: string): HTMLButtonElement {
	let name = branch

	if (defaultBranch !== undefined) {
		name = branch === defaultBranch ? `${branch} (default)` : `${branch} (default is ${defaultBranch})`
	}

	return textButton('git-branch', branch, `${name}, Switch Branch...`, 'checkout', target)
}
