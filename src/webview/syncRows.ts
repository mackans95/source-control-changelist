// The Repositories panel, which the view shows instead of the changes: every repository, also the
// clean ones, with its branch, how many commits it has to pull and push, and a button for the Git
// extension's Push, Pull, Sync or Publish Branch.
import { run } from './api.ts'
import { codicon, span } from './dom.ts'
import { branchButton, createRow, textButton } from './rows.ts'
import type { ActionTarget, SyncRepositoryItem, SyncState } from '../types/shared.ts'
import type { SyncButton } from '../types/webview.ts'

// The button each state gets, which Enter on the row runs too. Synced and detached repositories have
// none, so Enter switches branch.
const SYNC_BUTTONS: Record<SyncState, SyncButton | undefined> = {
	synced: undefined,
	ahead: { action: 'push', icon: 'repo-push', label: 'Push' },
	behind: { action: 'pull', icon: 'repo-pull', label: 'Pull' },
	diverged: { action: 'sync', icon: 'sync', label: 'Sync' },
	unpublished: { action: 'publish', icon: 'cloud-upload', label: 'Publish' },
	detached: undefined,
}

/** How many commits there are to pull and push, like the status bar's `1↓ 2↑`, with a tooltip that spells them out. */
function syncCounts(repository: SyncRepositoryItem): HTMLSpanElement {
	const element = span('counts')
	const descriptions: string[] = []
	const directions = [
		{ icon: 'arrow-down', count: repository.behind, verb: 'pull' },
		{ icon: 'arrow-up', count: repository.ahead, verb: 'push' },
	]

	for (const { icon, count, verb } of directions) {
		if (count > 0) {
			const countElement = span('count')
			countElement.append(span('count-number', String(count)), codicon(icon, 'count-icon'))
			element.append(countElement)
			descriptions.push(`${count} ${count === 1 ? 'commit' : 'commits'} to ${verb}`)
		}
	}

	if (descriptions.length > 0) {
		element.dataset.tooltip = descriptions.join(', ')
	}

	return element
}

/** A repository's row: its name, how far it is from its upstream, its branch and its sync button. */
function renderSyncRepository(rows: HTMLElement[], repository: SyncRepositoryItem): void {
	const target: ActionTarget = { repository: repository.id }
	const sync = SYNC_BUTTONS[repository.state]
	const row = createRow(rows, repository.id, 1, 'sync', target, undefined, () =>
		run(sync?.action ?? 'checkout', target),
	)

	// Looks like a repository's row in the changes, and shrinks the same way when the view is narrow.
	row.classList.add('repository')
	row.classList.toggle('needs-sync', repository.needsSync)
	row.dataset.tooltip = repository.path

	const toolbar = span('toolbar')

	if (repository.branch) {
		toolbar.append(branchButton(repository.branch, target))
	}

	row.append(codicon('repo'), span('label', repository.name), syncCounts(repository), span('spacer'), toolbar)

	// After the toolbar, so the branch shrinks when the view is narrow and the button keeps its text.
	if (sync) {
		const button = textButton(sync.icon, sync.label, sync.label, sync.action, target)
		button.classList.add('sync-button')
		row.append(button)
	}
}

/** The Repositories panel's rows, one per repository. */
export function renderSyncRepositories(rows: HTMLElement[], repositories: readonly SyncRepositoryItem[]): void {
	for (const repository of repositories) {
		renderSyncRepository(rows, repository)
	}
}
