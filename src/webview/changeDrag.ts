// Dragging files and folders between the groups in the changes: into a changelist, out of one onto
// Changes or Untracked Changes, onto Staged Changes to stage them, or from there to unstage them. The
// group a drop would land in is highlighted, and the extension does the rest.
import { canDropChanges } from '../helpers/shared.ts'
import { post } from './api.ts'
import { findRow, rowElements, rowOf } from './dom.ts'
import { tooltip } from './tooltip.ts'
import { tree } from './tree.ts'
import type { ActionTarget, MenuContext } from '../types/shared.ts'

// The drag's data type. Only this view knows it, so dropping files in an editor does nothing.
const DRAG_TYPE = 'application/vnd.changelist.changes'

/** What a row's actions run on, read back from its right-click menu context. */
function targetOf(row: HTMLElement | undefined): ActionTarget | undefined {
	if (!row?.dataset.vscodeContext) return undefined

	const { repository, kind, changelist, uri } = JSON.parse(row.dataset.vscodeContext) as MenuContext
	return { repository, kind, changelist, uri }
}

/** A file or folder being dragged to another group, and the group it would land in. */
class ChangeDrag {
	// What's being dragged: a file or a folder in its group.
	private source: ActionTarget | undefined
	// The group it lands in when it's dropped now, if it can.
	private target: ActionTarget | undefined

	/** Listens for drags on the page, like the Repositories panel's drags. */
	init(): void {
		document.addEventListener('dragstart', e => this.onDragStart(e))
		document.addEventListener('dragover', e => this.onDragOver(e))
		document.addEventListener('drop', e => this.onDrop(e))
		document.addEventListener('dragend', () => this.end())
		document.addEventListener('dragleave', e => {
			// Moving from one row to the next fires this too, so the highlight only goes once the mouse
			// is outside the view.
			if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight) {
				this.highlight(undefined)
			}
		})
	}

	/** Starts dragging a file or folder. The rows aren't drawn again until it ends. */
	private onDragStart(event: DragEvent): void {
		const row = rowOf(event.target)
		const source = row?.dataset.group === undefined ? undefined : targetOf(row)

		if (!row?.draggable || !source?.uri || !event.dataTransfer) return

		this.source = source
		event.dataTransfer.effectAllowed = 'move'
		event.dataTransfer.setData(DRAG_TYPE, source.uri)
		tooltip.hide()
		tree.setDragging(true)
		row.classList.add('dragging')
	}

	/** Highlights the group under the mouse when the files can go there, and allows the drop. */
	private onDragOver(event: DragEvent): void {
		// Something else, like a repository in the Repositories panel or a file from the Explorer.
		if (this.source === undefined) return

		const group = rowOf(event.target)?.dataset.group
		const target = targetOf(findRow(group))
		const lands = target && canDropChanges(this.source, target) ? group : undefined

		if (lands && event.dataTransfer) {
			event.preventDefault()
			event.dataTransfer.dropEffect = 'move'
		}

		this.target = lands ? target : undefined
		this.highlight(lands)
	}

	/** Asks the extension to move the files to the highlighted group. */
	private onDrop(event: DragEvent): void {
		if (this.source === undefined) return

		event.preventDefault()

		if (this.target) {
			post({ type: 'dropChanges', source: this.source, target: this.target })
		}

		this.end()
	}

	/** Highlights a group's row and the rows in it, or nothing. */
	private highlight(group: string | undefined): void {
		for (const row of rowElements()) {
			row.classList.toggle('drop-into', group !== undefined && row.dataset.group === group)
		}
	}

	/** Ends the drag, dropped or not, and draws the rows that came in during it. */
	private end(): void {
		// The Repositories panel's drags end here too, so this only cleans up its own.
		if (this.source === undefined) return

		this.highlight(undefined)
		rowElements().forEach(row => row.classList.remove('dragging'))
		this.source = undefined
		this.target = undefined
		tree.setDragging(false)
	}
}

export const changeDrag = new ChangeDrag()
