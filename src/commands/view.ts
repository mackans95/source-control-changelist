// The view's title bar buttons: refresh, list or tree, collapse or expand, and the Repositories panel.
import * as vscode from 'vscode'
import type { CommandTable, ViewMode } from '../types/extension.ts'
import type { ChangelistWebviewProvider } from '../view/provider.ts'

/** The view's title bar commands. */
export function viewCommands(provider: ChangelistWebviewProvider): CommandTable {
	return {
		refresh: () => provider.refresh(),
		viewAsTree: () => setViewMode('tree'),
		viewAsList: () => setViewMode('list'),
		collapseAll: () => provider.setAllExpanded(false),
		expandAll: () => provider.setAllExpanded(true),
		showRepositories: () => provider.showRepositories(true),
		// The same button with a dot, while a repository has commits to push or pull.
		showRepositoriesNeedsSync: () => provider.showRepositories(true),
		hideRepositories: () => provider.showRepositories(false),
	}
}

/** Saves list or tree mode in the user's settings. */
function setViewMode(mode: ViewMode): Thenable<void> {
	return vscode.workspace.getConfiguration('changelist').update('viewMode', mode, vscode.ConfigurationTarget.Global)
}
