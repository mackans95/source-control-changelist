// The tree of rows: the repositories the extension sent last, drawn again after every change, and
// what clicking a row does.
import { collapsedRows } from './collapse.ts'
import { getRoot, rowElements, rowOf, span } from './dom.ts'
import { rowFocus } from './focus.ts'
import { renderRepository } from './rows.ts'
import { tooltip } from './tooltip.ts'
import type { RepositoryItem } from '../types/shared.ts'

/**
 * Marks the repository rows whose name has shrunk as far as it can, without and with their
 * actions, so the branch label shrinks too (see styles.css). CSS alone would shrink the name and
 * the label at the same time.
 */
function fitRepositoryRows(): void {
	for (const row of rowElements().filter(r => r.classList.contains('repository'))) {
		row.classList.remove('narrow', 'narrow-with-actions')
		const narrow = row.scrollWidth > row.clientWidth
		row.classList.add('measuring')
		const narrowWithActions = row.scrollWidth > row.clientWidth
		row.classList.remove('measuring')
		row.classList.toggle('narrow', narrow)
		row.classList.toggle('narrow-with-actions', narrowWithActions)
	}
}

class Tree {
	// The repositories from the extension's latest update.
	private repositories: readonly RepositoryItem[] = []
	// Filled in on each render: each row's parent row, and what clicking the row does.
	private readonly parents = new Map<string, string>()
	private readonly activations = new Map<string, () => void>()

	/** Listens for clicks on the rows, and for the view changing size. */
	init(): void {
		const root = getRoot()

		root.addEventListener('click', e => {
			const row = rowOf(e.target)

			if (row?.dataset.id) {
				rowFocus.set(row)
				this.activate(row.dataset.id)
			}
		})

		// Right-clicking a row selects it, like in VS Code's trees. VS Code shows the menu itself, from
		// the row's `data-vscode-context`.
		root.addEventListener('contextmenu', e => rowFocus.set(rowOf(e.target)))

		new ResizeObserver(fitRepositoryRows).observe(root)
	}

	/** Draws the repositories from the extension's latest update. */
	update(repositories: readonly RepositoryItem[]): void {
		this.repositories = repositories
		this.render()
	}

	/** Notes a row being drawn: its parent row, and what clicking it does. */
	addRow(id: string, parentId: string | undefined, onActivate: () => void): void {
		if (parentId) {
			this.parents.set(id, parentId)
		}

		this.activations.set(id, onActivate)
	}

	/** The id of the row a row is in, if any. */
	parentOf(id: string): string | undefined {
		return this.parents.get(id)
	}

	/** Does what clicking the row does: collapses or expands it, or opens the file's changes. */
	activate(id: string): void {
		this.activations.get(id)?.()
	}

	/** Collapses an expanded row, or expands a collapsed one. */
	toggle(id: string): void {
		collapsedRows.toggle(id)
		this.render()
	}

	/** Expands or collapses every row, for the view's Expand All and Collapse All buttons. */
	setAllExpanded(expanded: boolean): void {
		collapsedRows.setAll(expanded)
		this.render()
	}

	/** Draws all rows again, keeping the selected row. */
	render(): void {
		// The element the tooltip belongs to is about to be replaced.
		tooltip.hide()
		const root = getRoot()
		const hadFocus = root.contains(document.activeElement)
		const rows: HTMLElement[] = []
		collapsedRows.clearCollapsible()
		this.parents.clear()
		this.activations.clear()

		for (const repository of this.repositories) {
			renderRepository(rows, repository)
		}

		if (rows.length === 0) {
			root.replaceChildren(span('empty', 'No changes in any repository.'))
		} else {
			root.replaceChildren(...rows)
		}

		rowFocus.restore(rows, hadFocus)
		fitRepositoryRows()
		collapsedRows.reportAllCollapsed(this.repositories.map(repository => repository.id))
	}
}

export const tree = new Tree()
