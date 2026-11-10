// Helpers the extension and the webview's script both use. Each side is bundled on its own, so this
// ends up copied into each of them rather than shared at runtime. Nothing here may depend on the
// vscode or Node APIs, which the webview doesn't have.
import type { ActionTarget } from '../types/shared.ts'

/**
 * A theme color as a CSS value. Webviews get the theme's colors as CSS variables with the dots as
 * dashes, so `gitDecoration.addedResourceForeground` is
 * `var(--vscode-gitDecoration-addedResourceForeground)`.
 */
export function themeColor(id: string): string {
	return `var(--vscode-${id.replace(/\./g, '-')})`
}

/**
 * Whether files dragged from one group can be dropped on another group of the same repository: into
 * a changelist from anywhere else, out of a list onto Changes or Untracked Changes, onto Staged
 * Changes to stage them, and from Staged Changes onto Changes or a list to unstage them. Merge
 * Changes is Git's own, so nothing goes in or out of it.
 */
export function canDropChanges(from: ActionTarget, to: ActionTarget): boolean {
	if (from.repository !== to.repository || from.kind === 'merge' || to.kind === 'merge') return false
	if (to.kind === 'staged') return from.kind !== 'staged'
	if (to.changelist !== undefined) return from.changelist !== to.changelist
	return from.changelist !== undefined || (from.kind === 'staged' && to.kind === 'changes')
}
