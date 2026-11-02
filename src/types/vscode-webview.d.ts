// The API VS Code gives scripts in a webview. A page can only acquire it once.
interface VsCodeApi {
	postMessage(message: import('./webview').WebviewMessage): void
	getState(): import('./webview').WebviewState | undefined
	setState(state: import('./webview').WebviewState): void
}

declare function acquireVsCodeApi(): VsCodeApi
