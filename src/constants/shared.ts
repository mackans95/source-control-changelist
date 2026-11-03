// Values the extension and the webview's script both have to agree on. Each side is bundled on its
// own, so this ends up copied into each of them rather than shared at runtime. Nothing here may
// depend on the vscode or Node APIs, which the webview doesn't have.

// The element in the webview's page that the rows are drawn in. styles.css selects it as #root too.
export const ROOT_ELEMENT_ID = 'root'

// VS Code's default workbench.hover.delay, in milliseconds: how long the mouse rests on a row
// before its tooltip shows.
export const DEFAULT_HOVER_DELAY_MS = 500
