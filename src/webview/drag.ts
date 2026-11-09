// Dragging repositories in the Repositories panel into the order you want, which the changes follow
// too. A repository moves with its worktrees, and a line shows where it lands. Alt+Up and Alt+Down
// move the selected one with the keyboard. The extension saves the order.
import { post } from './api.ts'
import { rowElements, rowOf } from './dom.ts'
import { tooltip } from './tooltip.ts'
import { tree } from './tree.ts'
import type { DropTarget } from '../types/webview.ts'

// The drag's data type. Only this view knows it, so dropping a repository in an editor does nothing.
const DRAG_TYPE = 'application/vnd.changelist.repository'

/** The repositories that can be dragged, in their order on screen: every one that isn't a worktree below its own. */
function draggableRepositories(): string[] {
	return rowElements()
		.filter(row => row.draggable)
		.map(row => row.dataset.repository ?? '')
}

/** The rows of a repository and its worktrees, from top to bottom. */
function blockRows(repository: string): HTMLElement[] {
	return rowElements().filter(row => row.dataset.repository === repository)
}

/**
 * Where a drop at the mouse lands: before or after the repository under it, whichever half of it and
 * its worktrees the mouse is in. Below the rows, it's after the last one.
 */
function dropTarget(event: DragEvent): DropTarget | undefined {
	const last = rowElements().at(-1)
	const below = last !== undefined && event.clientY > last.getBoundingClientRect().bottom
	const repository = (rowOf(event.target) ?? (below ? last : undefined))?.dataset.repository

	if (!repository) return undefined

	const block = blockRows(repository)
	const top = block[0].getBoundingClientRect().top
	const bottom = block[block.length - 1].getBoundingClientRect().bottom

	return {
		repository,
		after: event.clientY > (top + bottom) / 2,
	}
}

/** Whether a drop would leave the repository where it is: on itself, or right next to it. */
function staysPut(dragged: string, target: DropTarget): boolean {
	const order = draggableRepositories()
	const from = order.indexOf(dragged)
	const to = order.indexOf(target.repository)

	return to === from || (to === from + 1 && !target.after) || (to === from - 1 && target.after)
}

/** A repository being dragged in the Repositories panel, and the line where it would land. */
class RepositoryDrag {
	// The repository being dragged, by root URI.
	private dragged: string | undefined
	// Where it lands when it's dropped now, if anywhere.
	private target: DropTarget | undefined

	/**
	 * Listens for drags on the page, not just the rows, so a repository can be dropped below the last
	 * one too.
	 */
	init(): void {
		document.addEventListener('dragstart', e => this.onDragStart(e))
		document.addEventListener('dragover', e => this.onDragOver(e))
		document.addEventListener('drop', e => this.onDrop(e))
		document.addEventListener('dragend', () => this.end())
		document.addEventListener('dragleave', e => {
			// Moving from one row to the next fires this too, so the line only goes once the mouse is
			// outside the view.
			if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight) {
				this.showLine(undefined)
			}
		})
	}

	/** Moves a repository above the one before it, or below the one after it, for Alt+Up and Alt+Down. */
	moveByKeyboard(repository: string, down: boolean): void {
		const order = draggableRepositories()
		const target = order[order.indexOf(repository) + (down ? 1 : -1)]

		if (target !== undefined) {
			post({ type: 'moveRepository', repository, target, after: down })
		}
	}

	/** Starts dragging a repository, with its worktrees. The rows aren't drawn again until it ends. */
	private onDragStart(event: DragEvent): void {
		const row = rowOf(event.target)
		const repository = row?.dataset.repository

		if (!row?.draggable || !repository || !event.dataTransfer) return

		this.dragged = repository
		event.dataTransfer.effectAllowed = 'move'
		event.dataTransfer.setData(DRAG_TYPE, repository)
		tooltip.hide()
		tree.setDragging(true)
		blockRows(repository).forEach(r => r.classList.add('dragging'))
	}

	/** Shows where the repository would land, and allows the drop there. */
	private onDragOver(event: DragEvent): void {
		// Something else, like a file from the Explorer.
		if (this.dragged === undefined) return

		const target = dropTarget(event)
		const lands = target && !staysPut(this.dragged, target) ? target : undefined

		if (lands && event.dataTransfer) {
			event.preventDefault()
			event.dataTransfer.dropEffect = 'move'
		}

		this.showLine(lands)
	}

	/** Asks the extension to move the repository where the line is. */
	private onDrop(event: DragEvent): void {
		if (this.dragged === undefined) return

		event.preventDefault()

		if (this.target) {
			const { repository, after } = this.target
			post({ type: 'moveRepository', repository: this.dragged, target: repository, after })
		}

		this.end()
	}

	/** Shows the line above or below where the repository would land, or hides it. */
	private showLine(target: DropTarget | undefined): void {
		this.target = target
		rowElements().forEach(row => row.classList.remove('drop-before', 'drop-after'))

		if (!target) return

		const block = blockRows(target.repository)

		if (target.after) {
			block[block.length - 1].classList.add('drop-after')
		} else {
			block[0].classList.add('drop-before')
		}
	}

	/** Ends the drag, dropped or not, and draws the rows that came in during it. */
	private end(): void {
		this.showLine(undefined)
		rowElements().forEach(row => row.classList.remove('dragging'))
		this.dragged = undefined
		tree.setDragging(false)
	}
}

export const repositoryDrag = new RepositoryDrag()
