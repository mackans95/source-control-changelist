// Moving through the rows with the keyboard, like in VS Code's trees.
import { post } from './api.ts'
import { findRow, rowElements } from './dom.ts'
import { repositoryDrag } from './drag/repositories.ts'
import { rowFocus } from './focus.ts'
import { tree } from './tree.ts'

/** Handles a key pressed in the view, like VS Code's trees, and Alt+Up and Alt+Down in the Repositories panel. */
export function onKeydown(event: KeyboardEvent): void {
	const rows = rowElements()
	const index = rows.findIndex(row => row.dataset.id === rowFocus.id)
	const row = rows[index]

	if (!row?.dataset.id) return

	const id = row.dataset.id
	const expanded = row.getAttribute('aria-expanded')

	// Shift+F10 opens the menu on every platform. The menu key, on keyboards that have one, already
	// does by itself.
	if (event.key === 'F10' && event.shiftKey) {
		openMenu(row)
		event.preventDefault()
		return
	}

	// Moves the repository like dragging it does, so its row stays selected.
	if (
		event.altKey &&
		row.draggable &&
		row.dataset.repository &&
		(event.key === 'ArrowUp' || event.key === 'ArrowDown')
	) {
		repositoryDrag.moveByKeyboard(row.dataset.repository, event.key === 'ArrowDown')
		event.preventDefault()
		return
	}

	switch (event.key) {
		case 'ArrowDown':
			rowFocus.set(rows[index + 1])
			break
		case 'ArrowUp':
			rowFocus.set(rows[index - 1])
			break
		case 'Home':
			rowFocus.set(rows[0])
			break
		case 'End':
			rowFocus.set(rows[rows.length - 1])
			break
		case 'ArrowRight':
			if (expanded === 'false') {
				tree.toggle(id)
			} else if (expanded === 'true') {
				rowFocus.set(rows[index + 1])
			}
			break
		case 'ArrowLeft':
			if (expanded === 'true') {
				tree.toggle(id)
			} else {
				rowFocus.set(findRow(tree.parentOf(id)))
			}
			break
		case 'Enter':
		case ' ':
			tree.activate(id)
			break
		case 'Escape':
			if (!tree.showingRepositories) return
			post({ type: 'closeRepositories' })
			break
		default:
			return
	}

	event.preventDefault()
}

/** Opens the right-click menu for a row from the keyboard, below the row like in VS Code's trees. */
function openMenu(row: HTMLElement): void {
	const { left, bottom } = row.getBoundingClientRect()
	row.dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: left, clientY: bottom }),
	)
}
