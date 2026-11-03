// Which rows are collapsed. It's kept in the page's state, so it's still there after the view was
// hidden.
import { post, readState, writeState } from './api.ts'

/** The collapsed rows, and the rows that can collapse. */
class CollapsedRows {
	// Ids of the collapsed rows; load() reads them from the page's state.
	private ids = new Set<string>()
	// The rows that can collapse, collected while the rows are drawn, for collapsing them all.
	private collapsible: string[] = []
	// What the extension was told last, so it's only told when that changes.
	private lastAllCollapsed: boolean | undefined

	/** Reads the collapsed rows the page saved before it was hidden. */
	load(): void {
		this.ids = new Set(readState()?.collapsed ?? [])
	}

	/** Whether a row is collapsed. */
	has(id: string): boolean {
		return this.ids.has(id)
	}

	/** Collapses an expanded row, or expands a collapsed one. */
	toggle(id: string): void {
		if (this.ids.has(id)) {
			this.ids.delete(id)
		} else {
			this.ids.add(id)
		}

		this.save()
	}

	/** Expands every row, or collapses every row that was drawn. */
	setAll(expanded: boolean): void {
		this.ids.clear()

		if (!expanded) {
			this.collapsible.forEach(id => this.ids.add(id))
		}

		this.save()
	}

	/** Forgets the collapsible rows, before the rows are drawn again. */
	clearCollapsible(): void {
		this.collapsible = []
	}

	/** Notes that a row being drawn can collapse. */
	addCollapsible(id: string): void {
		this.collapsible.push(id)
	}

	/** Tells the extension whether every repository is collapsed, which picks the Collapse All or Expand All button. */
	reportAllCollapsed(repositoryIds: readonly string[]): void {
		const allCollapsed = repositoryIds.length > 0 && repositoryIds.every(id => this.ids.has(id))

		if (allCollapsed !== this.lastAllCollapsed) {
			this.lastAllCollapsed = allCollapsed
			post({ type: 'allCollapsed', value: allCollapsed })
		}
	}

	/** Saves the collapsed rows in the page's state. */
	private save(): void {
		writeState({ collapsed: [...this.ids] })
	}
}

export const collapsedRows = new CollapsedRows()
