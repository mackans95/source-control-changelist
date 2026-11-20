// Add to .gitignore, on files and folders Git doesn't track yet. The Git extension's own command only
// takes the rows of its own view, so this adds them to .gitignore like it does.
import * as path from 'path'
import * as vscode from 'vscode'
import { forSelected } from './nodes.ts'
import { Status } from '#constants/git.ts'
import type { CommandTable, FolderNode, ResourceNode } from '#types/extension.ts'
import type { Repository } from '#types/git.ts'

/** Add to .gitignore, on a row or on all the selected rows. */
export function gitignoreCommands(): CommandTable {
	return {
		addToGitignore: forSelected(['folder', 'resource'], nodes => addToGitignore(nodes.filter(isUntracked))),
	}
}

/** Adds the files and folders to the end of their repository's .gitignore, and shows it. */
async function addToGitignore(nodes: readonly (FolderNode | ResourceNode)[]): Promise<void> {
	const repositories = new Map(nodes.map(node => [node.repository.rootUri.toString(), node.repository]))

	for (const [root, repository] of repositories) {
		const lines = nodes.filter(node => node.repository.rootUri.toString() === root).map(gitignoreLine)
		await appendToGitignore(repository, [...new Set(lines)])
	}
}

/** Whether Git tracks none of a file's or folder's changes yet. */
function isUntracked(node: FolderNode | ResourceNode): boolean {
	const changes = node.type === 'resource' ? [node.change] : node.changes
	return changes.every(change => change.status === Status.UNTRACKED)
}

/** A file's or folder's line in .gitignore: its path from the repository's root, so it matches only itself. */
function gitignoreLine(node: FolderNode | ResourceNode): string {
	const uri = node.type === 'resource' ? node.change.uri : node.uri
	const relative = path.relative(node.repository.rootUri.fsPath, uri.fsPath).split(path.sep).join('/')
	// A leading / ties it to the root, and a trailing one to folders. *, ? and [ would be patterns.
	const escaped = relative.replace(/[*?[\\]/g, '\\$&')

	return node.type === 'folder' ? `/${escaped}/` : `/${escaped}`
}

/** Adds lines to the end of the repository's .gitignore, which is made when there's none, and saves and shows it. */
async function appendToGitignore(repository: Repository, lines: readonly string[]): Promise<void> {
	const uri = vscode.Uri.joinPath(repository.rootUri, '.gitignore')
	const exists = await vscode.workspace.fs.stat(uri).then(
		() => true,
		() => false,
	)
	// Like the Git extension, a new .gitignore opens unsaved at its path, and saving writes it there.
	const document = await vscode.workspace.openTextDocument(exists ? uri : uri.with({ scheme: 'untitled' }))
	const last = document.lineAt(document.lineCount - 1)
	const edit = new vscode.WorkspaceEdit()

	await vscode.window.showTextDocument(document)
	edit.insert(document.uri, last.range.end, `${last.isEmptyOrWhitespace ? '' : '\n'}${lines.join('\n')}\n`)
	await vscode.workspace.applyEdit(edit)
	await document.save()
}
