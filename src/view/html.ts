// The Changelist view's pages: the one the script draws the changes in, and the one shown when Git
// is turned off.
import { randomBytes } from 'crypto'
import * as vscode from 'vscode'
import { ROOT_ELEMENT_ID } from '../constants/shared.ts'

/** A page with the view's stylesheet, which may only load what `csp` allows. */
function page(webview: vscode.Webview, extensionUri: vscode.Uri, csp: readonly string[], body: string): string {
	const styles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'))
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp.join('; ')}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styles}">
</head>
${body}
</html>`
}

/** The view's page: the element the rows are drawn in, and the script that draws them. */
export function viewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = randomBytes(16).toString('base64')
	const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'))
	const csp = [
		"default-src 'none'",
		`font-src ${webview.cspSource}`,
		`img-src ${webview.cspSource}`,
		`style-src ${webview.cspSource}`,
		`script-src 'nonce-${nonce}'`,
	]

	// The body's `data-vscode-context` leaves out the Cut, Copy and Paste items VS Code adds to the
	// right-click menu.
	const body = `<body data-vscode-context='{"preventDefaultContextMenuItems": true}'>
	<div id="${ROOT_ELEMENT_ID}" role="tree" aria-label="Changelist"></div>
	<script nonce="${nonce}" src="${script}"></script>
</body>`
	return page(webview, extensionUri, csp, body)
}

/** The view's page when Git is turned off: a message where the changes would be, and no script. */
export function unavailableHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const csp = ["default-src 'none'", `style-src ${webview.cspSource}`]
	const body = `<body>
	<div class="empty">Git is turned off. Turn on the <code>git.enabled</code> setting, then reload the window to see your changes here.</div>
</body>`
	return page(webview, extensionUri, csp, body)
}
