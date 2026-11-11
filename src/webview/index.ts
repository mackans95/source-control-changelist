// The webview's script: draws the rows the extension sends, like VS Code's own trees, and sends back
// what the user does with them.
import { post } from './api.ts'
import { collapsedRows } from './collapse.ts'
import { getRoot } from './dom.ts'
import { changeDrag } from './drag/changes.ts'
import { repositoryDrag } from './drag/repositories.ts'
import { loadFonts } from './icons.ts'
import { onKeydown } from './keyboard.ts'
import { tooltip } from './tooltip.ts'
import { tree } from './tree.ts'
import type { ExtensionMessage } from '#types/shared.ts'

start()

/** Starts the page. The other files only define what this starts. */
function start(): void {
	collapsedRows.load()
	tooltip.init()
	tree.init()
	repositoryDrag.init()
	changeDrag.init()
	getRoot().addEventListener('keydown', onKeydown)
	window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => onMessage(event.data))
	// The extension sends the first update once the page says it's ready.
	post({ type: 'ready' })
}

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
