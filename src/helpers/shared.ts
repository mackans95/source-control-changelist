// Helpers the extension and the webview's script both use. Each side is bundled on its own, so this
// ends up copied into each of them rather than shared at runtime. Nothing here may depend on the
// vscode or Node APIs, which the webview doesn't have.

/**
 * A theme color as a CSS value. Webviews get the theme's colors as CSS variables with the dots as
 * dashes, so `gitDecoration.addedResourceForeground` is
 * `var(--vscode-gitDecoration-addedResourceForeground)`.
 */
export function themeColor(id: string): string {
	return `var(--vscode-${id.replace(/\./g, '-')})`
}
