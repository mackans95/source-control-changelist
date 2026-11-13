// The left side of a split file's diff from one of its lists: HEAD's version with the file's other
// lists' changes in it, so the diff with the file shows only that list's changes.
import * as vscode from 'vscode'
import { hunkLists } from '#model/changelists.ts'
import { withHunks } from '#model/hunks.ts'
import type { Services } from '#types/extension.ts'

// The URI scheme of these documents.
export const PART_SCHEME = 'changelist-part'

/** The URI of a file without one list's changes, for that list's diff. Undefined is Changes. */
export function partUri(file: vscode.Uri, list: string | undefined): vscode.Uri {
	return file.with({ scheme: PART_SCHEME, query: JSON.stringify({ list: list ?? null }) })
}

/** Split files without one list's changes, read again whenever the changes or their lists change. */
export class HunkDocuments implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private readonly services: Services
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>()
	// The emitter, and the listeners that read the open documents again.
	private readonly disposables: vscode.Disposable[]

	// When an open document's content changes.
	readonly onDidChange = this.changeEmitter.event

	constructor(services: Services) {
		this.services = services
		this.disposables = [
			this.changeEmitter,
			services.hunks.onDidChange(() => this.refresh()),
			services.changelists.onDidChange(() => this.refresh()),
		]
	}

	/** HEAD's version of the file, with the changes that aren't in the URI's list. */
	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const file = uri.with({ scheme: 'file', query: '' })
		const repository = this.services.git.getRepository(file)

		if (!repository) return ''

		const head = await repository.show('HEAD', file.fsPath)
		const commit = repository.state.HEAD?.commit
		const hunks = this.services.hunks.get(repository, file)
		const change = repository.state.workingTreeChanges.find(c => c.uri.toString() === file.toString())

		// Until the changes are read, the diff shows all of them.
		if (!commit || !hunks || !change) return head

		const { list } = JSON.parse(uri.query) as { list: string | null }
		const lists = hunkLists(this.services.changelists.get(repository), change, hunks, commit)

		return withHunks(
			head,
			hunks.filter((_, i) => lists[i] !== (list ?? undefined)),
		)
	}

	/** Stops listening. */
	dispose(): void {
		this.disposables.forEach(d => d.dispose())
	}

	/** Reads the open documents again. */
	private refresh(): void {
		for (const document of vscode.workspace.textDocuments) {
			if (document.uri.scheme === PART_SCHEME) {
				this.changeEmitter.fire(document.uri)
			}
		}
	}
}
