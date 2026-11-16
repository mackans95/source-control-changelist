// The view's selection, with a fake page: what clicks, right-clicks and keys select, and what the view
// tells the extension, which runs the commands on those rows.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { ROOT_ELEMENT_ID } from '../src/constants/shared.ts'
import { rowElements } from '../src/webview/dom.ts'
import { onKeydown } from '../src/webview/keyboard.ts'
import { selection } from '../src/webview/selection.ts'
import { tree } from '../src/webview/tree.ts'
import type { MenuContext, WebviewMessage } from '#types/shared.ts'

// What the view sent the extension, newest last.
const messages: WebviewMessage[] = []

describe('the selection', () => {
	before(() => {
		GlobalRegistrator.register()
		Object.assign(globalThis, {
			acquireVsCodeApi: () => ({
				postMessage: (message: WebviewMessage) => messages.push(message),
				getState: () => undefined,
				setState: () => {},
			}),
		})
		document.body.innerHTML = `<div id="${ROOT_ELEMENT_ID}"></div>`
		tree.init()
	})
	after(() => GlobalRegistrator.unregister())
	beforeEach(() => {
		drawRows(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
		click('a.ts')
	})

	test('a click selects the row alone, and tells the extension', () => {
		click('c.ts')
		assert.deepEqual(selected(), ['c.ts'])
		assert.deepEqual(sent(), ['c.ts'])
	})
	test('Ctrl+click and Cmd+click add rows, and take selected ones out', () => {
		click('c.ts', { ctrlKey: true })
		click('d.ts', { metaKey: true })
		assert.deepEqual(sent(), ['a.ts', 'c.ts', 'd.ts'])

		click('a.ts', { ctrlKey: true })
		assert.deepEqual(sent(), ['c.ts', 'd.ts'])
	})
	test('Shift+click selects the rows from the row clicked last', () => {
		click('b.ts')
		click('d.ts', { shiftKey: true })
		assert.deepEqual(sent(), ['b.ts', 'c.ts', 'd.ts'])

		click('a.ts', { shiftKey: true })
		assert.deepEqual(sent(), ['a.ts', 'b.ts'])
	})
	test('right-clicking a selected row keeps the selection, for the menu to act on', () => {
		click('c.ts', { ctrlKey: true })
		rightClick('a.ts')
		assert.deepEqual(sent(), ['a.ts', 'c.ts'])
	})
	test('right-clicking another row selects it alone', () => {
		click('c.ts', { ctrlKey: true })
		rightClick('b.ts')
		assert.deepEqual(sent(), ['b.ts'])
	})
	test('Shift+arrows select the rows in between', () => {
		press('ArrowDown', { shiftKey: true })
		press('ArrowDown', { shiftKey: true })
		assert.deepEqual(sent(), ['a.ts', 'b.ts', 'c.ts'])

		press('ArrowUp', { shiftKey: true })
		assert.deepEqual(sent(), ['a.ts', 'b.ts'])
	})
	test('Escape keeps only the focused row selected', () => {
		click('c.ts', { shiftKey: true })
		press('Escape')
		assert.deepEqual(sent(), ['c.ts'])
	})
	test('the selection stays when the rows are drawn again, without the rows that went away', () => {
		click('c.ts', { shiftKey: true })
		drawRows(['a.ts', 'c.ts', 'd.ts'])
		// What the tree does after it draws the rows.
		selection.restore(rowElements(), true)
		assert.deepEqual(sent(), ['a.ts', 'c.ts'])
	})
})

/** Replaces the rows with these files' rows in Changes, like the view draws them. */
function drawRows(files: readonly string[]): void {
	const root = document.getElementById(ROOT_ELEMENT_ID)!
	root.replaceChildren(
		...files.map(file => {
			const row = document.createElement('div')
			const context: MenuContext = {
				webviewSection: 'file',
				preventDefaultContextMenuItems: true,
				repository: 'file:///repo',
				kind: 'changes',
				uri: `file:///repo/${file}`,
			}
			row.className = 'row'
			row.dataset.id = file
			row.dataset.vscodeContext = JSON.stringify(context)
			return row
		}),
	)
}

/** Clicks a file's row. */
function click(file: string, keys: MouseEventInit = {}): void {
	row(file).dispatchEvent(new MouseEvent('click', { bubbles: true, ...keys }))
}

/** Right-clicks a file's row, which opens its menu. */
function rightClick(file: string): void {
	row(file).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
}

/** Presses a key in the view. */
function press(key: string, keys: KeyboardEventInit = {}): void {
	onKeydown(new KeyboardEvent('keydown', { key, ...keys }))
}

/** A file's row. */
function row(file: string): HTMLElement {
	return document.querySelector<HTMLElement>(`[data-id="${file}"]`)!
}

/** The files whose rows are drawn as selected. */
function selected(): string[] {
	return [...document.querySelectorAll<HTMLElement>('.row.selected')].map(r => r.dataset.id!)
}

/** The files the view last told the extension are selected, which the commands run on. */
function sent(): string[] {
	const selections = messages.flatMap(message => (message.type === 'select' ? [message.targets] : []))
	return (selections.at(-1) ?? []).map(target => target.uri!.replace('file:///repo/', ''))
}
