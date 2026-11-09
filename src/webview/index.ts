// Renders the Changelist view in its webview. The extension sends the repositories with changes;
// this draws them as a tree that looks and behaves like VS Code's own, and sends clicks back as
// actions. It keeps which rows are collapsed, also while the view is hidden. While the Repositories
// panel is open, the extension sends every repository's sync status too, which is drawn instead.
import { post } from './api.ts'
import { collapsedRows } from './collapse.ts'
import { getRoot } from './dom.ts'
import { loadFonts } from './icons.ts'
import { onKeydown } from './keyboard.ts'
import { tooltip } from './tooltip.ts'
import { tree } from './tree.ts'
import type { ExtensionMessage } from '../types/shared.ts'

/** Handles a message from the extension. */
function onMessage(message: ExtensionMessage): void {
	switch (message.type) {
		case 'update':
			loadFonts(message.fonts)
			getRoot().classList.toggle('always-show-actions', message.alwaysShowActions)
			tooltip.setDelay(message.hoverDelay)
			tree.update(message.repositories, message.syncRepositories, message.autoFetch)
			break
		case 'setAllExpanded':
			tree.setAllExpanded(message.expanded)
			break
	}
}

/** The only code that does anything when the script loads; the other files only define functions and create instances that wait to be used. */
function start(): void {
	collapsedRows.load()
	tooltip.init()
	tree.init()
	getRoot().addEventListener('keydown', onKeydown)
	window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => onMessage(event.data))
	// The extension sends the first update once the page says it's ready.
	post({ type: 'ready' })
}

start()
