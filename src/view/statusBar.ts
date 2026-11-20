// The active changelist in the status bar, for the repository of the file being edited, so it's clear
// where new changes go. Clicking it picks another one.
import * as vscode from 'vscode'
import { GROUP_LABELS } from '#model/changes.ts'
import { repositoryName } from '#model/repositories.ts'
import type { RepositoryNode, Services } from '#types/extension.ts'
import type { Repository } from '#types/git.ts'

/** The status bar item with the active changelist. It's hidden when the repository has no lists. */
export class ActiveChangelistStatus implements vscode.Disposable {
	private readonly services: Services
	private readonly item: vscode.StatusBarItem
	// The events it shows the active list again after.
	private readonly listeners: vscode.Disposable[]
	// The root URI of the repository it showed last, which it keeps showing while no file of another one is open.
	private last: string | undefined

	constructor(services: Services) {
		this.services = services
		this.item = vscode.window.createStatusBarItem('changelist.activeChangelist', vscode.StatusBarAlignment.Left)
		this.item.name = 'Active Changelist'
		this.listeners = [
			vscode.window.onDidChangeActiveTextEditor(() => this.update()),
			services.changelists.onDidChange(() => this.update()),
			services.git.onDidOpenRepository(() => this.update()),
			services.git.onDidCloseRepository(() => this.update()),
		]
		this.update()
	}

	/** Takes the item away, and stops listening. */
	dispose(): void {
		this.listeners.forEach(listener => listener.dispose())
		this.item.dispose()
	}

	/** Shows the active list of the repository being edited in, or hides the item when it has no lists. */
	private update(): void {
		const repository = this.repository()
		const changelists = repository && this.services.changelists.get(repository)

		if (!repository || !changelists?.lists.length) {
			this.item.hide()
			return
		}

		const active = changelists.active ?? GROUP_LABELS.changes
		const node: RepositoryNode = { type: 'repository', repository }

		this.last = repository.rootUri.toString()
		this.item.text = `$(checklist) ${active}`
		this.item.tooltip = `New changes in ${repositoryName(repository)} go to ${active}. Click to pick another changelist.`
		this.item.command = {
			command: 'changelist.pickActiveChangelist',
			title: 'Set Active Changelist',
			arguments: [node],
		}
		this.item.show()
	}

	/** The repository of the file being edited, or else the one it showed last, or else the only one with lists. */
	private repository(): Repository | undefined {
		const { git, changelists } = this.services
		const uri = vscode.window.activeTextEditor?.document.uri
		const editing = uri && git.getRepository(uri)

		if (editing) return editing

		// `git.repositories` makes new objects on every call, so they're found by their URI.
		const withLists = git.repositories.filter(repository => changelists.get(repository).lists.length > 0)
		const last = withLists.find(repository => repository.rootUri.toString() === this.last)

		return last ?? (withLists.length === 1 ? withLists[0] : undefined)
	}
}
