// The Repositories panel's rows: every repository with its branch, how far it is from its upstream,
// its sync button, and how Fetch All, Pull All or Checkout Default went. Worktrees fold under theirs.
import { addTwistie, branchButton, createRow, repositoryIcon, repositoryTooltip, textButton } from './common.ts'
import { themeColor } from '#helpers/shared.ts'
import { post, run } from '#webview/api.ts'
import { button, codicon, span } from '#webview/dom.ts'
import type { ActionTarget, OperationState, SyncRepositoryItem, SyncState } from '#types/shared.ts'
import type { StatusIcon, SyncButton } from '#types/webview.ts'

// The button each state gets, which Enter on the row runs too. Without one, Enter switches branch.
const SYNC_BUTTONS: Record<SyncState, SyncButton | undefined> = {
	synced: undefined,
	ahead: { action: 'push', icon: 'repo-push', label: 'Push' },
	behind: { action: 'pull', icon: 'repo-pull', label: 'Pull' },
	diverged: { action: 'sync', icon: 'sync', label: 'Sync' },
	unpublished: { action: 'publish', icon: 'cloud-upload', label: 'Publish' },
	detached: undefined,
}

// The icon at the end of a row for each state of Fetch All, Pull All or Checkout Default.
const STATUS_ICONS: Record<OperationState, StatusIcon> = {
	running: { icon: 'loading', color: 'foreground' },
	done: { icon: 'check', color: 'testing.iconPassed' },
	failed: { icon: 'error', color: 'errorForeground' },
	skipped: { icon: 'circle-slash', color: 'descriptionForeground' },
}

/** The panel's rows, one per repository, without the worktrees of a folded repository. */
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

/** A repository's row, with an arrow that folds its worktrees. Returns whether they're shown. */
function renderSyncRepository(rows: HTMLElement[], repository: SyncRepositoryItem, worktrees: number): boolean {
	const target: ActionTarget = { repository: repository.id }
	const sync = SYNC_BUTTONS[repository.state]
	const row = createSyncRow(rows, repository, () => run(sync?.action ?? 'checkout', target))
	// A click folds the worktrees, and Enter still runs the button.
	const expanded = worktrees > 0 ? addTwistie(row, rowId(repository.id)) : true

	if (worktrees === 0) {
		row.append(span('twistie'))
	}

	const toolbar = span('toolbar')

	if (repository.branch) {
		toolbar.append(branchButton(repository.branch, target, repository.defaultBranch))
	}

	// Folded worktrees are counted after the name, so they aren't forgotten.
	const folded = expanded ? [] : [span('description', worktrees === 1 ? '1 worktree' : `${worktrees} worktrees`)]
	// A worktree's name starts with `wt:`, so it can't be mistaken for a repository of its own.
	const prefix = repository.kind === 'worktree' ? [span('worktree-prefix', 'wt:')] : []

	row.append(
		repositoryIcon(repository.kind),
		...prefix,
		nameLabel(repository),
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

/** A repository's row, which looks and shrinks like a repository's row in the changes. */
function createSyncRow(rows: HTMLElement[], repository: SyncRepositoryItem, onActivate: () => void): HTMLDivElement {
	const level = repository.parentId ? 2 : 1
	const parentId = repository.parentId && rowId(repository.parentId)
	const row = createRow(
		rows,
		rowId(repository.id),
		level,
		'sync',
		{ repository: repository.id },
		parentId,
		onActivate,
	)

	// A worktree moves with its repository, and only a repository that isn't a worktree can be dragged.
	row.dataset.repository = repository.parentId ?? repository.id
	row.draggable = repository.parentId === undefined
	row.classList.add('repository')
	row.classList.toggle('needs-sync', repository.needsSync)
	row.classList.toggle('nested', repository.parentId !== undefined)
	row.dataset.tooltip = repositoryTooltip(repository)

	return row
}

/** A row's id in the panel, apart from the same repository's row in the changes. */
function rowId(repositoryId: string): string {
	return `${repositoryId}#sync`
}

/** The repository's name, with a `*` after it when it has uncommitted changes, like the status bar's branch. */
function nameLabel(repository: SyncRepositoryItem): HTMLSpanElement {
	const label = span('label')
	label.append(span('label-name', repository.name))

	if (repository.hasChanges) {
		const changes = span('changes-mark', '*')
		changes.dataset.tooltip = 'Uncommitted changes'
		label.append(changes)
	}

	return label
}

/** How many commits there are to pull and push, like the status bar's `1↓ 2↑`. */
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

/** The icon for how Fetch All, Pull All or Checkout Default went, with the reason in its tooltip. */
function statusIcon(repository: SyncRepositoryItem): HTMLSpanElement | undefined {
	if (!repository.status) return undefined

	const { icon, color } = STATUS_ICONS[repository.status.state]
	const element = codicon(icon, 'status-icon')
	element.classList.toggle('codicon-modifier-spin', repository.status.state === 'running')
	element.style.setProperty('color', themeColor(color))
	element.dataset.tooltip = repository.status.message
	return element
}
