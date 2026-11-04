// Types only the Changelist view's webview script uses.
import type { WebviewAction, WebviewMessage } from './shared.ts'

/** How a change category looks in a repository's counts. */
export interface CategoryDisplay {
	/** Codicon shown before the count on the repository's row. */
	readonly icon: string
	/** Follows the count in the row's tooltip, like `3 added`. */
	readonly label: string
	/** Theme color ID for the icon and count, like `gitDecoration.addedResourceForeground`. */
	readonly color: string
}

/** The button a repository gets in the Repositories panel for its sync state. */
export interface SyncButton {
	/** The `changelist.*` command it runs, which runs the Git extension's own. */
	readonly action: WebviewAction
	/** Codicon shown before the label. */
	readonly icon: string
	readonly label: string
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
