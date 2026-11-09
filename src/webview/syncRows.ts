// The Repositories panel, which the view shows instead of the changes: every repository, also the
// clean ones, with its branch, how many commits it has to pull and push, and a button for the Git
// extension's Push, Pull, Sync or Publish Branch. A repository's worktrees fold under it, and the end
// of each row shows how Fetch All, Pull All or Checkout Default went.
import { post, run } from './api.ts'
import { button, codicon, span } from './dom.ts'
import { addTwistie, branchButton, createRow, repositoryIcon, repositoryTooltip, textButton } from './rows.ts'
import { themeColor } from '../helpers/shared.ts'
import type { ActionTarget, OperationState, SyncRepositoryItem, SyncState } from '../types/shared.ts'
import type { StatusIcon, SyncButton } from '../types/webview.ts'

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
// The icon at the end of a row for each state of Fetch/Pull All or Checkout Default.
const STATUS_ICONS: Record<OperationState, StatusIcon> = {
	running: { icon: 'loading', color: 'foreground' },
	done: { icon: 'check', color: 'testing.iconPassed' },
	failed: { icon: 'error', color: 'errorForeground' },
	skipped: { icon: 'circle-slash', color: 'descriptionForeground' },
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

/** The icon for how Fetch/Pull All or Checkout Default went, with the reason in its tooltip. */
function statusIcon(repository: SyncRepositoryItem): HTMLSpanElement | undefined {
	if (!repository.status) return undefined

	const { icon, color } = STATUS_ICONS[repository.status.state]
	const element = codicon(icon, 'status-icon')
	element.classList.toggle('codicon-modifier-spin', repository.status.state === 'running')
	element.style.setProperty('color', themeColor(color))
	element.dataset.tooltip = repository.status.message
	return element
}

/** A row's id in the panel, apart from the same repository's row in the changes, which folds its groups. */
function rowId(repositoryId: string): string {
	return `${repositoryId}#sync`
}

/**
 * A repository's row: its name, how far it is from its upstream, its branch and its sync button. A
 * repository with worktrees gets an arrow that folds them, and returns whether they're shown.
 */
function renderSyncRepository(rows: HTMLElement[], repository: SyncRepositoryItem, worktrees: number): boolean {
	const target: ActionTarget = { repository: repository.id }
	const sync = SYNC_BUTTONS[repository.state]
	const level = repository.parentId ? 2 : 1
	const parentId = repository.parentId && rowId(repository.parentId)
	const row = createRow(rows, rowId(repository.id), level, 'sync', target, parentId, () =>
		run(sync?.action ?? 'checkout', target),
	)
	// Each row knows the repository it moves with when it's dragged: its own, or a worktree's
	// repository. Only a repository that isn't a worktree below its own can be dragged.
	row.dataset.repository = repository.parentId ?? repository.id
	row.draggable = repository.parentId === undefined
	// A click folds the worktrees, and Enter still runs the button.
	const expanded = worktrees > 0 ? addTwistie(row, rowId(repository.id)) : true

	if (worktrees === 0) {
		row.append(span('twistie'))
	}

	// Looks like a repository's row in the changes, and shrinks the same way when the view is narrow.
	row.classList.add('repository')
	row.classList.toggle('needs-sync', repository.needsSync)
	row.classList.toggle('nested', repository.parentId !== undefined)
	row.dataset.tooltip = repositoryTooltip(repository)

	const toolbar = span('toolbar')

	if (repository.branch) {
		toolbar.append(branchButton(repository.branch, target, repository.defaultBranch))
	}

	// The name, with a `*` right after it when there's something to commit, like the branch in the
	// status bar.
	const label = span('label')
	label.append(span('label-name', repository.name))
	// Folded worktrees are counted after the name, so they aren't forgotten.
	const folded = expanded ? [] : [span('description', worktrees === 1 ? '1 worktree' : `${worktrees} worktrees`)]

	if (repository.hasChanges) {
		const changes = span('changes-mark', '*')
		changes.dataset.tooltip = 'Uncommitted changes'
		label.append(changes)
	}

	// A worktree's name starts with `wt:`, so it can't be mistaken for a repository of its own.
	const prefix = repository.kind === 'worktree' ? [span('worktree-prefix', 'wt:')] : []

	row.append(
		repositoryIcon(repository.kind),
		...prefix,
		label,
		syncCounts(repository),
		...folded,
		span('spacer'),
		toolbar,
	)

	// After the toolbar, so the branch shrinks when the view is narrow and the button keeps its text.
	if (sync) {
		const button = textButton(sync.icon, sync.label, sync.label, sync.action, target)
		button.classList.add('sync-button')
		row.append(button)
	}

	const status = statusIcon(repository)

	if (status) {
		row.append(status)
	}

	return expanded
}

/**
 * The Repositories panel's rows, one per repository, with the worktrees of a folded repository left
 * out. Each worktree comes right after its repository.
 */
export function renderSyncRepositories(rows: HTMLElement[], repositories: readonly SyncRepositoryItem[]): void {
	const folded = new Set<string>()

	for (const repository of repositories) {
		if (repository.parentId && folded.has(repository.parentId)) continue

		const worktrees = repositories.filter(r => r.parentId === repository.id).length

		if (!renderSyncRepository(rows, repository, worktrees)) {
			folded.add(repository.id)
		}
	}
}

/** Says that Git doesn't fetch by itself, with a link that turns on `git.autofetch`. */
export function autoFetchNotice(): HTMLElement {
	const notice = span(
		'notice',
		"Git doesn't fetch by itself, so new commits on the remotes only show up after Fetch All.",
	)
	const link = button('notice-link', 'Sets git.autofetch in your user settings', () =>
		post({ type: 'turnOnAutoFetch' }),
	)
	link.textContent = 'Turn on auto fetch'
	notice.append(link)
	return notice
}
