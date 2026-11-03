// Types only the Changelist view's webview script uses.
import type { WebviewMessage } from './shared.ts'

/** How a change category looks in a repository's counts. */
export interface CategoryDisplay {
	/** Codicon shown before the count on the repository's row. */
	readonly icon: string
	/** Follows the count in the row's tooltip, like `3 added`. */
	readonly label: string
	/** CSS variable of the theme color for the icon and count. */
	readonly color: string
}

/** What the webview keeps while it's hidden and reloaded. */
export interface WebviewState {
	readonly collapsed: readonly string[]
}

/** The API VS Code gives scripts in a webview, from acquireVsCodeApi(). A page can only acquire it once. */
export interface VsCodeApi {
	postMessage(message: WebviewMessage): void
	getState(): WebviewState | undefined
	setState(state: WebviewState): void
}
