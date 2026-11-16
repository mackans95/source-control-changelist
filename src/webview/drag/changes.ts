// Dragging files and folders between the groups in the changes, the selected ones together.
// canDropChanges() decides where they can go, and the extension moves, stages or unstages them.
import { Drag } from './drag.ts'
import { canDropChanges } from '#helpers/shared.ts'
import { post } from '#webview/api.ts'
import { findRow, rowElements, rowOf, targetOf } from '#webview/dom.ts'
import { selection } from '#webview/selection.ts'
import type { ActionTarget } from '#types/shared.ts'
import type { DragStart } from '#types/webview.ts'

/** Files or folders being dragged, with the group it would land in highlighted. */
class ChangeDrag extends Drag<readonly ActionTarget[]> {
	protected readonly dragType = 'application/vnd.changelist.changes'
	// The group they land in when they're dropped now, if some of them can.
	private target: ActionTarget | undefined

	/** Drags a file or folder in a group, or all the selected ones when it's one of them. */
	protected start(row: HTMLElement): DragStart<readonly ActionTarget[]> | undefined {
		const selected = selection.rows()
		const rows = (selected.includes(row) ? selected : [row]).filter(
			r => r.draggable && r.dataset.group !== undefined,
		)
		const sources = rows.flatMap(r => targetOf(r) ?? []).filter(source => source.uri !== undefined)

		return sources.length > 0 ? { source: sources, data: sources.map(s => s.uri).join('\n'), rows } : undefined
	}

	/** Highlights the group under the mouse when some of the files can go there. */
	protected show(event: DragEvent, sources: readonly ActionTarget[]): boolean {
		const group = rowOf(event.target)?.dataset.group
		const target = targetOf(findRow(group))

		this.target = target && sources.some(source => canDropChanges(source, target)) ? target : undefined
		highlight(this.target ? group : undefined)

		return this.target !== undefined
	}

	/** Asks the extension to move the files that can go to the highlighted group. */
	protected drop(sources: readonly ActionTarget[]): void {
		const target = this.target

		if (target) {
			post({ type: 'dropChanges', sources: sources.filter(source => canDropChanges(source, target)), target })
		}
	}

	/** Takes the highlight away. */
	protected clear(): void {
		this.target = undefined
		highlight(undefined)
	}
}

export const changeDrag = new ChangeDrag()

/** Highlights a group's row and the rows in it, or nothing. */
function highlight(group: string | undefined): void {
	for (const row of rowElements()) {
		row.classList.toggle('drop-into', group !== undefined && row.dataset.group === group)
	}
}
