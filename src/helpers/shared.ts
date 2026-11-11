// Helpers both the extension and the webview use, so they can't use the vscode or Node APIs.
import type { ActionTarget } from '../types/shared.ts'

/** A theme color as webviews have it, a CSS variable like `var(--vscode-gitDecoration-addedResourceForeground)`. */
export function themeColor(id: string): string {
	return `var(--vscode-${id.replace(/\./g, '-')})`
}

/** Whether files dragged from one group can be dropped on another group of the same repository. */
export function canDropChanges(from: ActionTarget, to: ActionTarget): boolean {
	// Merge Changes is Git's own, so nothing goes in or out of it.
	if (from.repository !== to.repository || from.kind === 'merge' || to.kind === 'merge') return false
	// Staged Changes stages them.
	if (to.kind === 'staged') return from.kind !== 'staged'
	// A changelist takes them from anywhere else.
	if (to.changelist !== undefined) return from.changelist !== to.changelist
	// Changes and Untracked Changes take them out of a list, and Changes unstages them.
	return from.changelist !== undefined || (from.kind === 'staged' && to.kind === 'changes')
}
