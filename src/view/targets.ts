// Turns a row's target, from the webview or a right-click menu, back into the node the commands take.
import * as path from 'path'
import * as vscode from 'vscode'
import { groupChanges } from '../model/changelists.ts'
import type { FolderNode, Node, Services } from '../types/extension.ts'
import type { Change, Repository } from '../types/git.ts'
import type { ActionTarget, GroupKind } from '../types/shared.ts'

/** The repository, group, folder or file a target points at, or undefined when it's gone. */
export function resolveTarget({ git, changelists }: Services, target: ActionTarget): Node | undefined {
	// `git.repositories` makes new objects on every call, so they're found by their URI.
	const repository = git.repositories.find(r => r.rootUri.toString() === target.repository)

	if (!repository) return undefined

	if (!target.kind) {
		return { type: 'repository', repository }
	}

	const { kind, changelist } = target
	const changes = groupChanges(repository, kind, changelists.get(repository), changelist)

	if (!target.uri) {
		return { type: 'group', repository, kind, changelist, changes }
	}

	const change = changes.find(c => c.uri.toString() === target.uri)

	if (change) {
		return { type: 'resource', repository, kind, changelist, change }
	}

	const folder = folderNode(repository, kind, changelist, vscode.Uri.parse(target.uri), changes)

	// A row whose files no longer have changes, like one drawn before a commit. The Git API's add and
	// revert would take no paths as every path.
	return folder.changes.length > 0 ? folder : undefined
}

/** A folder's node with the group's changes below it. The commands don't need its rows. */
function folderNode(
	repository: Repository,
	kind: GroupKind,
	changelist: string | undefined,
	uri: vscode.Uri,
	changes: readonly Change[],
): FolderNode {
	const prefix = uri.fsPath + path.sep

	return {
		type: 'folder',
		repository,
		kind,
		changelist,
		uri,
		label: path.basename(uri.fsPath),
		changes: changes.filter(c => c.uri.fsPath.startsWith(prefix)),
		children: [],
	}
}
