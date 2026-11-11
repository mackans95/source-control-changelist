// Dragging files and folders between the groups in the changes. canDropChanges() decides where they
// can go, and the extension moves, stages or unstages them.
import { Drag } from './drag.ts'
import { canDropChanges } from '#helpers/shared.ts'
import { post } from '#webview/api.ts'
import { findRow, rowElements, rowOf } from '#webview/dom.ts'
import type { ActionTarget, MenuContext } from '#types/shared.ts'
import type { DragStart } from '#types/webview.ts'

/** A file or folder being dragged, with the group it would land in highlighted. */
class ChangeDrag extends Drag<ActionTarget> {
	protected readonly dragType = 'application/vnd.changelist.changes'
	// The group it lands in when it's dropped now, if it can.
	private target: ActionTarget | undefined

	/** Drags a file or folder in a group. */
	protected start(row: HTMLElement): DragStart<ActionTarget> | undefined {
		const source = row.dataset.group === undefined ? undefined : targetOf(row)
		return source?.uri ? { source, data: source.uri, rows: [row] } : undefined
	}

	/** Highlights the group under the mouse when the files can go there. */
	protected show(event: DragEvent, source: ActionTarget): boolean {
		const group = rowOf(event.target)?.dataset.group
		const target = targetOf(findRow(group))

		this.target = target && canDropChanges(source, target) ? target : undefined
		highlight(this.target ? group : undefined)

		return this.target !== undefined
	}

	/** Asks the extension to move the files to the highlighted group. */
	protected drop(source: ActionTarget): void {
		if (this.target) {
			post({ type: 'dropChanges', source, target: this.target })
		}
	}

	/** Takes the highlight away. */
	protected clear(): void {
		this.target = undefined
		highlight(undefined)
	}
}

export const changeDrag = new ChangeDrag()

/** What a row's actions run on, read back from its right-click menu context. */
function targetOf(row: HTMLElement | undefined): ActionTarget | undefined {
	if (!row?.dataset.vscodeContext) return undefined

	const { repository, kind, changelist, uri } = JSON.parse(row.dataset.vscodeContext) as MenuContext

	return { repository, kind, changelist, uri }
}

/** Highlights a group's row and the rows in it, or nothing. */
function highlight(group: string | undefined): void {
	for (const row of rowElements()) {
		row.classList.toggle('drop-into', group !== undefined && row.dataset.group === group)
	}
}
