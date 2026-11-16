// Which rows are selected, and which one has the keyboard focus, like in VS Code's trees. A click
// selects one row, Ctrl/Cmd+click adds or takes away one, and Shift+click or Shift+arrow selects the
// rows in between. Only the focused row is reachable with Tab. The extension is told what's selected,
// so a right-click menu or a row's button on a selected row acts on all of them.
import { post } from './api.ts'
import { rowElements, targetOf } from './dom.ts'

/** The selected rows and the focused one, which stay when the rows are drawn again. */
class RowSelection {
	// The row that has the keyboard focus, or had it last.
	private focusedId: string | undefined
	private selectedIds = new Set<string>()
	// Where Shift+click and Shift+arrow select from: the row selected last without Shift.
	private anchorId: string | undefined
	// What the extension was told last, so it's only told when that changes.
	private lastSent = '[]'

	/** The focused row's id. */
	get id(): string | undefined {
		return this.focusedId
	}

	/** The selected rows on screen, from top to bottom. */
	rows(): HTMLElement[] {
		return rowElements().filter(row => row.dataset.id !== undefined && this.selectedIds.has(row.dataset.id))
	}

	/** Selects only this row, and gives it the keyboard focus unless `focus` is false. */
	set(row: HTMLElement | undefined, focus = true): void {
		if (!row?.dataset.id) return

		this.selectedIds = new Set([row.dataset.id])
		this.anchorId = row.dataset.id
		this.focus(row, focus)
	}

	/** Adds a row to the selection, or takes it away, and focuses it. */
	toggle(row: HTMLElement): void {
		const id = row.dataset.id

		if (!id) return

		if (this.selectedIds.has(id)) {
			this.selectedIds.delete(id)
		} else {
			this.selectedIds.add(id)
		}

		this.anchorId = id
		this.focus(row)
	}

	/** Selects the rows from the anchor to this row, and focuses it. */
	extend(row: HTMLElement | undefined): void {
		if (!row?.dataset.id) return

		const rows = rowElements()
		const anchor = rows.findIndex(r => r.dataset.id === this.anchorId)
		const index = rows.indexOf(row)

		// Without an anchor on screen, like after the anchor's row went away, the range starts at this row.
		if (anchor === -1) {
			this.anchorId = row.dataset.id
		}

		const [first, last] = anchor === -1 ? [index, index] : [Math.min(anchor, index), Math.max(anchor, index)]
		this.selectedIds = new Set(rows.slice(first, last + 1).flatMap(r => (r.dataset.id ? [r.dataset.id] : [])))
		this.focus(row)
	}

	/** Before the right-click menu opens: a selected row keeps the selection, and another row is selected alone. */
	openMenu(row: HTMLElement | undefined): void {
		if (row?.dataset.id && this.selectedIds.has(row.dataset.id)) {
			this.focus(row)
		} else {
			this.set(row)
		}
	}

	/** Selects only the focused row, when several are selected. Returns whether it did. */
	selectOnlyFocused(): boolean {
		if (this.selectedIds.size < 2) return false

		this.set(rowElements().find(row => row.dataset.id === this.focusedId))
		return true
	}

	/** After the rows are drawn again: keeps the selected rows that are still there, or else selects the first, and focuses it when the view had the focus. */
	restore(rows: readonly HTMLElement[], hadFocus: boolean): void {
		if (rows.length === 0) {
			this.focusedId = undefined
			this.selectedIds.clear()
			this.send()
			return
		}

		const ids = new Set(rows.flatMap(row => (row.dataset.id ? [row.dataset.id] : [])))
		const selected = [...this.selectedIds].filter(id => ids.has(id))
		const focused =
			rows.find(row => row.dataset.id === this.focusedId) ?? rows.find(row => row.dataset.id === selected[0])

		if (!focused?.dataset.id) {
			this.set(rows[0], hadFocus)
			return
		}

		this.selectedIds = new Set(selected.length > 0 ? selected : [focused.dataset.id])
		this.focus(focused, hadFocus)
	}

	/** Gives a row the keyboard focus, draws which rows are selected, and tells the extension. */
	private focus(row: HTMLElement, focus = true): void {
		this.focusedId = row.dataset.id

		for (const other of rowElements()) {
			const selected = other.dataset.id !== undefined && this.selectedIds.has(other.dataset.id)
			other.tabIndex = other === row ? 0 : -1
			other.classList.toggle('focused', other === row)
			other.classList.toggle('selected', selected)
			other.setAttribute('aria-selected', String(selected))
		}

		if (focus) {
			row.focus({ preventScroll: true })
			row.scrollIntoView({ block: 'nearest' })
		}

		this.send()
	}

	/** Tells the extension which rows are selected, when that changed. */
	private send(): void {
		const targets = this.rows().flatMap(row => targetOf(row) ?? [])
		const json = JSON.stringify(targets)

		if (json !== this.lastSent) {
			this.lastSent = json
			post({ type: 'select', targets })
		}
	}
}

export const selection = new RowSelection()
