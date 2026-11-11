// What dragging repositories and dragging files share: the page's listeners, allowing the drop,
// the mouse leaving the view, and cleaning up when the drag ends.
import { rowElements, rowOf } from '#webview/dom.ts'
import { tooltip } from '#webview/tooltip.ts'
import { tree } from '#webview/tree.ts'
import type { DragStart } from '#types/webview.ts'

/** A drag of rows in the view. The rows aren't drawn again until it ends, since that would end it. */
export abstract class Drag<Source> {
	// What's being dragged, from the start of the drag until it ends.
	private source: Source | undefined

	// The drag's data type. Only this view knows it, so dropping in an editor does nothing.
	protected abstract readonly dragType: string

	/** Listens on the page, not just the rows, so a drop can land below the last row too. */
	init(): void {
		document.addEventListener('dragstart', e => this.onDragStart(e))
		document.addEventListener('dragover', e => this.onDragOver(e))
		document.addEventListener('drop', e => this.onDrop(e))
		document.addEventListener('dragend', () => this.end())
		document.addEventListener('dragleave', e => this.onDragLeave(e))
	}

	/** What dragging a row starts, or undefined when this drag doesn't take the row. */
	protected abstract start(row: HTMLElement): DragStart<Source> | undefined

	/** Shows where a drop at the mouse would land, and returns whether it can land there. */
	protected abstract show(event: DragEvent, source: Source): boolean

	/** Drops what's dragged where it was last shown landing. */
	protected abstract drop(source: Source): void

	/** Stops showing where a drop would land. */
	protected abstract clear(): void

	/** Starts dragging a row, when this drag takes it. */
	private onDragStart(event: DragEvent): void {
		const row = rowOf(event.target)
		const start = row?.draggable ? this.start(row) : undefined

		if (!start || !event.dataTransfer) return

		this.source = start.source
		event.dataTransfer.effectAllowed = 'move'
		event.dataTransfer.setData(this.dragType, start.data)
		tooltip.hide()
		tree.setDragging(true)
		start.rows.forEach(r => r.classList.add('dragging'))
	}

	/** Shows where the drop would land, and allows it there. */
	private onDragOver(event: DragEvent): void {
		// Something else, like the other kind of drag or a file from the Explorer.
		if (this.source === undefined) return

		if (this.show(event, this.source) && event.dataTransfer) {
			event.preventDefault()
			event.dataTransfer.dropEffect = 'move'
		}
	}

	/** Drops what's dragged, and ends the drag. */
	private onDrop(event: DragEvent): void {
		if (this.source === undefined) return

		event.preventDefault()
		this.drop(this.source)
		this.end()
	}

	/** Stops showing where the drop would land once the mouse is outside the view. */
	private onDragLeave(event: DragEvent): void {
		// Moving from one row to the next fires this too.
		const outside =
			event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight

		if (this.source !== undefined && outside) {
			this.clear()
		}
	}

	/** Ends the drag, dropped or not, and draws the rows that came in during it. */
	private end(): void {
		// The other kind of drag ends here too.
		if (this.source === undefined) return

		this.clear()
		rowElements().forEach(row => row.classList.remove('dragging'))
		this.source = undefined
		tree.setDragging(false)
	}
}
