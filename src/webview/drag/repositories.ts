// Dragging a repository with its worktrees in the Repositories panel, or moving it with Alt+Up and
// Alt+Down. The extension saves the order, which the changes follow too.
import { Drag } from './drag.ts'
import { post } from '#webview/api.ts'
import { rowElements, rowOf } from '#webview/dom.ts'
import type { DragStart, DropTarget } from '#types/webview.ts'

/** A repository being dragged, with a line where it would land. */
class RepositoryDrag extends Drag<string> {
	protected readonly dragType = 'application/vnd.changelist.repository'
	// Where it lands when it's dropped now, if anywhere.
	private target: DropTarget | undefined

	/** Moves a repository above the one before it, or below the one after it. */
	moveByKeyboard(repository: string, down: boolean): void {
		const order = draggableRepositories()
		const target = order[order.indexOf(repository) + (down ? 1 : -1)]

		if (target !== undefined) {
			post({ type: 'moveRepository', repository, target, after: down })
		}
	}

	/** Drags a repository with its worktrees. */
	protected start(row: HTMLElement): DragStart<string> | undefined {
		const repository = row.dataset.repository
		return repository ? { source: repository, data: repository, rows: blockRows(repository) } : undefined
	}

	/** Shows the line where the repository would land, unless it would stay where it is. */
	protected show(event: DragEvent, dragged: string): boolean {
		const target = dropTarget(event)
		this.target = target && !staysPut(dragged, target) ? target : undefined
		showLine(this.target)
		return this.target !== undefined
	}

	/** Asks the extension to move the repository where the line is. */
	protected drop(dragged: string): void {
		if (this.target) {
			post({
				type: 'moveRepository',
				repository: dragged,
				target: this.target.repository,
				after: this.target.after,
			})
		}
	}

	/** Hides the line. */
	protected clear(): void {
		this.target = undefined
		showLine(undefined)
	}
}

export const repositoryDrag = new RepositoryDrag()

/** The repositories that can be dragged, in their order on screen: every one that isn't a worktree. */
function draggableRepositories(): string[] {
	return rowElements()
		.filter(row => row.draggable)
		.map(row => row.dataset.repository ?? '')
}

/** The rows of a repository and its worktrees, from top to bottom. */
function blockRows(repository: string): HTMLElement[] {
	return rowElements().filter(row => row.dataset.repository === repository)
}

/** Where a drop at the mouse lands: before or after the repository under it, or after the last one. */
function dropTarget(event: DragEvent): DropTarget | undefined {
	const last = rowElements().at(-1)
	const below = last !== undefined && event.clientY > last.getBoundingClientRect().bottom
	const repository = (rowOf(event.target) ?? (below ? last : undefined))?.dataset.repository

	if (!repository) return undefined

	// Whichever half of the repository and its worktrees the mouse is in.
	const block = blockRows(repository)
	const top = block[0].getBoundingClientRect().top
	const bottom = block[block.length - 1].getBoundingClientRect().bottom

	return { repository, after: event.clientY > (top + bottom) / 2 }
}

/** Whether a drop would leave the repository where it is: on itself, or right next to it. */
function staysPut(dragged: string, target: DropTarget): boolean {
	const order = draggableRepositories()
	const from = order.indexOf(dragged)
	const to = order.indexOf(target.repository)

	return to === from || (to === from + 1 && !target.after) || (to === from - 1 && target.after)
}

/** Shows the line above or below where the repository would land, or hides it. */
function showLine(target: DropTarget | undefined): void {
	rowElements().forEach(row => row.classList.remove('drop-before', 'drop-after'))

	if (!target) return

	const block = blockRows(target.repository)

	if (target.after) {
		block[block.length - 1].classList.add('drop-after')
	} else {
		block[0].classList.add('drop-before')
	}
}
