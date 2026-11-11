// Moving single changes, blocks of changed lines, to another changelist: the ones at the cursor or in
// the selection from the editor's right-click menu, or the one in the gutter's change peek.
import * as vscode from 'vscode'
import { pickChangelist } from './changelists.ts'
import { changelistOf, hunkLists, moveFiles, moveHunks } from '#model/changelists.ts'
import { hunksInLines } from '#model/hunks.ts'
import type { CommandTable, LineChange, Services } from '#types/extension.ts'

/** The command that moves changes in a file to another changelist. */
export function hunkCommands(services: Services): CommandTable {
	return {
		// The peek passes the file, its changes and the one it shows. The editor's menu passes the file.
		moveChangeToChangelist: (uri?: vscode.Uri, changes?: readonly LineChange[], index?: number) => {
			const editor = vscode.window.activeTextEditor
			const file = uri ?? editor?.document.uri

			if (!file) return

			const lines = changes && index !== undefined ? [peekLines(changes[index])] : selectedLines(editor, file)
			return moveChangesAt(services, file, lines)
		},
	}
}

/** Moves the changes on these lines of a file, first to last counted from 1, to a list picked from a list. */
async function moveChangesAt(services: Services, file: vscode.Uri, lines: readonly [number, number][]): Promise<void> {
	const { git, changelists, hunks } = services
	const repository = git.getRepository(file)
	const change = repository?.state.workingTreeChanges.find(c => c.uri.toString() === file.toString())

	if (!repository || !change) {
		void vscode.window.showInformationMessage('This file has no changes to move.')
		return
	}

	// The changes are read from the file on disk.
	await vscode.workspace.textDocuments.find(d => d.uri.toString() === file.toString() && d.isDirty)?.save()
	await repository.status()
	await hunks.track(repository)

	const head = repository.state.HEAD?.commit
	const fileHunks = hunks.get(repository, file)

	// A new, deleted or renamed file has one change, the whole file, so it moves whole.
	if (!head || !fileHunks) {
		const current = changelistOf(changelists.get(repository), change)
		const target = await pickChangelist(repository, changelists, current, 'Move to Changelist')

		if (target) {
			await changelists.update(repository, c => moveFiles(c, [change], target.list))
		}

		return
	}

	const moved = [...new Set(lines.flatMap(([first, last]) => hunksInLines(fileHunks, first, last)))]

	if (moved.length === 0) {
		void vscode.window.showInformationMessage("There's no change at the cursor to move.")
		return
	}

	const lists = hunkLists(changelists.get(repository), change, fileHunks, head)
	const title = moved.length === 1 ? 'Move Change to Changelist' : `Move ${moved.length} Changes to Changelist`
	const target = await pickChangelist(repository, changelists, lists[fileHunks.indexOf(moved[0])], title)

	if (target) {
		await changelists.update(repository, c => moveHunks(c, change, fileHunks, moved, target.list, head))
	}
}

/** The lines of the change the peek shows. A deletion is between its start line and the next. */
function peekLines(change: LineChange): [number, number] {
	const start = change.modifiedStartLineNumber
	return [start, change.modifiedEndLineNumber === 0 ? start : change.modifiedEndLineNumber]
}

/** The lines of each selection in the editor that has the file, or none when it isn't the active one. */
function selectedLines(editor: vscode.TextEditor | undefined, file: vscode.Uri): [number, number][] {
	if (editor?.document.uri.toString() !== file.toString()) return []

	return editor.selections.map(selection => [selection.start.line + 1, selection.end.line + 1])
}
