// Which row is selected. Only that row is reachable with Tab, like in VS Code's trees, and it stays
// selected when the rows are drawn again.
import { rowElements } from './dom.ts'

/** The selected row, which stays selected when the rows are drawn again. */
class RowFocus {
	// The row that has the keyboard focus, or had it last.
	private focusedId: string | undefined

	/** The selected row's id. */
	get id(): string | undefined {
		return this.focusedId
	}

	/** Selects a row, and gives it the keyboard focus unless `focus` is false. */
	set(row: HTMLElement | undefined, focus = true): void {
		if (!row) return

		for (const other of rowElements()) {
			other.tabIndex = -1
			other.classList.remove('focused')
		}

		row.tabIndex = 0
		row.classList.add('focused')
		this.focusedId = row.dataset.id

		if (focus) {
			row.focus({ preventScroll: true })
			row.scrollIntoView({ block: 'nearest' })
		}
	}

	/** After the rows are drawn again: selects the same row, or the first, and focuses it when the view had the focus. */
	restore(rows: readonly HTMLElement[], hadFocus: boolean): void {
		if (rows.length === 0) {
			this.focusedId = undefined
			return
		}

		this.set(rows.find(row => row.dataset.id === this.focusedId) ?? rows[0], hadFocus)
	}
}

export const rowFocus = new RowFocus()
