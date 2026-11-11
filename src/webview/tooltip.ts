// The tooltip, drawn like VS Code's hovers. The browser's own `title` tooltips are slow, and often
// don't show at all while the window isn't focused.
import { DEFAULT_HOVER_DELAY_MS } from '#constants/shared.ts'
import { getRoot, span } from './dom.ts'

// Like VS Code: right after a tooltip hides, the next one shows without waiting.
const SHOW_AGAIN_INSTANTLY_MS = 200
// The space between the tooltip and its element, and the view's edges.
const MARGIN = 4

/** The one tooltip element, shared by every element with a `data-tooltip`. */
class Tooltip {
	// Created by init().
	private element: HTMLSpanElement | undefined
	// How long the mouse rests on an element before its tooltip shows; the extension sends VS Code's setting.
	private delay = DEFAULT_HOVER_DELAY_MS
	// The element the tooltip is showing for, or waiting to show for.
	private target: HTMLElement | undefined
	// The wait before the tooltip shows.
	private timer: number | undefined
	// When the tooltip last hid, for SHOW_AGAIN_INSTANTLY_MS.
	private hiddenAt = 0
	// Where the mouse is across the view; the tooltip is centered on it.
	private mouseX = 0

	/** Adds the tooltip to the page, and shows it for elements with a `data-tooltip`. */
	init(): void {
		this.element = span('tooltip')
		this.element.setAttribute('role', 'tooltip')
		document.body.append(this.element)

		const root = getRoot()
		root.addEventListener('mouseover', e => this.onMouseOver(e))
		document.addEventListener('mousemove', e => {
			this.mouseX = e.clientX
		})

		// Like VS Code's hovers, the tooltip goes away when the mouse leaves, clicks, scrolls or types.
		root.addEventListener('mouseleave', () => this.hide())

		for (const type of ['mousedown', 'wheel', 'keydown', 'blur']) {
			window.addEventListener(type, () => this.hide())
		}
	}

	/** Sets how long the mouse rests on an element before its tooltip shows, in milliseconds. */
	setDelay(ms: number): void {
		this.delay = ms
	}

	/** Hides the tooltip, and stops one that's waiting to show. */
	hide(): void {
		clearTimeout(this.timer)
		this.timer = undefined
		this.target = undefined

		if (this.element?.classList.contains('visible')) {
			this.element.classList.remove('visible')
			this.hiddenAt = Date.now()
		}
	}

	/** Starts the wait for the tooltip of the element under the mouse. */
	private onMouseOver(event: MouseEvent): void {
		const target =
			(event.target instanceof Element && event.target.closest<HTMLElement>('[data-tooltip]')) || undefined

		if (target === this.target) return

		this.hide()

		if (target) {
			this.target = target
			const delay = Date.now() - this.hiddenAt < SHOW_AGAIN_INSTANTLY_MS ? 0 : this.delay
			this.timer = window.setTimeout(() => this.show(target), delay)
		}
	}

	/** Shows the tooltip under its element, at the mouse, and above it when there's no room below. */
	private show(target: HTMLElement): void {
		const element = this.element

		if (!element) return

		element.textContent = target.dataset.tooltip ?? ''
		element.style.setProperty('left', '0')
		element.style.setProperty('top', '0')
		element.classList.add('visible')

		const anchor = target.getBoundingClientRect()
		const { width, height } = element.getBoundingClientRect()
		const left = Math.max(MARGIN, Math.min(this.mouseX - width / 2, window.innerWidth - width - MARGIN))
		const below = anchor.bottom + MARGIN
		const top =
			below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, anchor.top - height - MARGIN)

		element.style.setProperty('left', `${left}px`)
		element.style.setProperty('top', `${top}px`)
	}
}

export const tooltip = new Tooltip()
