// The API VS Code gives scripts in a webview. A page can only acquire it once.
interface VsCodeApi {
	postMessage(message: import('./webview.ts').WebviewMessage): void
	getState(): import('./webview.ts').WebviewState | undefined
	setState(state: import('./webview.ts').WebviewState): void
}

declare function acquireVsCodeApi(): VsCodeApi
