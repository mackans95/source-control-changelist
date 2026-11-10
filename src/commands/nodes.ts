// What the commands that run on the view's rows share.
import type { FolderNode, GroupNode, Node, ResourceNode } from '../types/extension.ts'
import type { Change } from '../types/git.ts'

/** A command that runs on these kinds of rows, and does nothing on any other. */
export function forNodes<K extends Node['type']>(
	types: readonly K[],
	run: (node: Extract<Node, { type: K }>) => unknown,
): (node: Node | undefined) => unknown {
	return node => (node && types.includes(node.type as K) ? run(node as Extract<Node, { type: K }>) : undefined)
}

/** A file's change, or the changes in a group or folder. */
export function changesOf(node: GroupNode | FolderNode | ResourceNode): readonly Change[] {
	return node.type === 'resource' ? [node.change] : node.changes
}

/** The changes' paths, which the Git API's add, revert and clean take. */
export function paths(changes: readonly Change[]): string[] {
	return changes.map(c => c.uri.fsPath)
}
