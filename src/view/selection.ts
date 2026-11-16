// Which rows a command on a row runs on: all the selected rows when the row is one of them, like in
// VS Code's trees, or else the row alone. No vscode, so the tests run it.
import type { ActionTarget } from '#types/shared.ts'

/** The rows a command on `target` runs on: the selection when `target` is in it, or else `target` alone. */
export function selectedTargets(selection: readonly ActionTarget[], target: ActionTarget): readonly ActionTarget[] {
	return selection.some(selected => sameTarget(selected, target)) ? selection : [target]
}

/** Whether two targets are the same row. A right-click menu's context has more fields, which don't count. */
function sameTarget(a: ActionTarget, b: ActionTarget): boolean {
	return a.repository === b.repository && a.kind === b.kind && a.changelist === b.changelist && a.uri === b.uri
}
