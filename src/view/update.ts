// The update message: every row the webview draws, and the settings that change how it draws them.
import * as vscode from 'vscode'
import { toRepositoryItem, toSyncRepositoryItem } from './items.ts'
import { DEFAULT_HOVER_DELAY_MS } from '../constants/shared.ts'
import { hasChanges } from '../model/changes.ts'
import type { IconResolver, Services, ViewMode } from '../types/extension.ts'
import type { Repository } from '../types/git.ts'
import type { ExtensionMessage, RepositoryItem, SyncRepositoryItem } from '../types/shared.ts'

/** The update for these repositories, sorted in the view's order. */
export function buildUpdate(
	services: Services,
	repositories: readonly Repository[],
	icons: IconResolver,
	showingRepositories: boolean,
): ExtensionMessage {
	return {
		type: 'update',
		repositories: changesRows(services, repositories, icons),
		syncRepositories: showingRepositories ? repositoryRows(services, repositories) : undefined,
		autoFetch: vscode.workspace.getConfiguration('git').get<boolean | string>('autofetch', false) !== false,
		fonts: icons.fonts(),
		alwaysShowActions: vscode.workspace.getConfiguration('scm').get<boolean>('alwaysShowActions', false),
		hoverDelay: vscode.workspace.getConfiguration('workbench').get<number>('hover.delay', DEFAULT_HOVER_DELAY_MS),
	}
}

/** The changes' rows, for the repositories that have changes. */
function changesRows(
	{ changelists }: Services,
	repositories: readonly Repository[],
	icons: IconResolver,
): RepositoryItem[] {
	const viewMode = vscode.workspace.getConfiguration('changelist').get<ViewMode>('viewMode', 'list')

	// Filtered after sorting, so a worktree stays below its repository when both have changes.
	return repositories
		.filter(hasChanges)
		.map(repository => toRepositoryItem(repository, changelists.get(repository), viewMode, icons))
}

/** The Repositories panel's rows, for every repository. */
function repositoryRows(
	{ defaultBranches, operations }: Services,
	repositories: readonly Repository[],
): SyncRepositoryItem[] {
	return repositories.map(repository => ({
		...toSyncRepositoryItem(repository, repositories),
		defaultBranch: defaultBranches.get(repository),
		status: operations.get(repository),
	}))
}
