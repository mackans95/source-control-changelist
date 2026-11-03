// The API VS Code gives the webview's page: messages to the extension, and the page's state, which
// VS Code keeps while the view is hidden.
import type { ActionTarget, WebviewAction, WebviewMessage } from '../types/shared.ts'
import type { VsCodeApi, WebviewState } from '../types/webview.ts'

// Defined by VS Code in the webview's page; this only tells TypeScript it's there.
declare function acquireVsCodeApi(): VsCodeApi

// A page can only acquire the API once, so it's kept after the first time.
let api: VsCodeApi | undefined

/** The API, acquired the first time it's needed. */
function getApi(): VsCodeApi {
	api ??= acquireVsCodeApi()
	return api
}

/** Sends a message to the extension. */
export function post(message: WebviewMessage): void {
	getApi().postMessage(message)
}

/** Asks the extension to run one of the `changelist.*` commands on a row. */
export function run(action: WebviewAction, target: ActionTarget): void {
	post({ type: 'run', action, target })
}

/** What the page saved before it was hidden or reloaded, if anything. */
export function readState(): WebviewState | undefined {
	return getApi().getState()
}

/** Saves what the page should still have after it's hidden or reloaded. */
export function writeState(state: WebviewState): void {
	getApi().setState(state)
}
