// The elements the view is drawn with, and what the files creating them share.
import { ROOT_ELEMENT_ID } from '#constants/shared.ts'

// Every row in the tree: repositories, groups, folders and files.
const ROW_SELECTOR = '.row'

/** The element the rows are drawn in, from the extension's page. */
export function getRoot(): HTMLElement {
	return document.getElementById(ROOT_ELEMENT_ID)!
}

/** The rows on screen, from top to bottom. */
export function rowElements(): HTMLElement[] {
	return [...getRoot().querySelectorAll<HTMLElement>(ROW_SELECTOR)]
}

/** The row with this id, when it's on screen. */
export function findRow(id: string | undefined): HTMLElement | undefined {
	return rowElements().find(row => row.dataset.id === id)
}

/** The row an event happened in, like a click on one of its buttons. */
export function rowOf(target: EventTarget | null): HTMLElement | undefined {
	return (target instanceof Element && target.closest<HTMLElement>(ROW_SELECTOR)) || undefined
}

/** A span with a class, and text when it's given. */
export function span(className: string, text?: string): HTMLSpanElement {
	const element = document.createElement('span')
	element.className = className

	if (text !== undefined) {
		element.textContent = text
	}

	return element
}

/** A codicon, from the codicon font that styles/index.css imports. */
export function codicon(name: string, className = 'icon'): HTMLSpanElement {
	return span(`${className} codicon codicon-${name}`)
}

/** A button with a tooltip, which doesn't also click the row it's in. */
export function button(className: string, title: string, onClick: () => void): HTMLButtonElement {
	const element = document.createElement('button')

	element.className = className
	element.dataset.tooltip = title
	element.setAttribute('aria-label', title)
	// Like the inline actions in VS Code's trees: reached with the mouse, not with Tab.
	element.tabIndex = -1
	element.addEventListener('click', e => {
		e.stopPropagation()
		onClick()
	})

	return element
}
