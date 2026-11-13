// What the integration tests share: a Git repository of its own for each test, the commands run with the
// context the view's right-click menus give them, and dialogs that give the answers each test queues.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import * as vscode from 'vscode'
import type { API, GitExtension, Repository } from '#types/git.ts'
import type { MenuContext } from '#types/shared.ts'

// How long the extension gets to read the changes after Git's status check. It has no event the tests
// can wait for, and it takes well under this.
const SETTLE_MS = 1000
// How long a repository gets to open, and a condition to come true.
const TIMEOUT_MS = 20_000

// The answers the next dialogs give, in order, by kind of dialog.
const answers = { input: [] as string[], pick: [] as string[], warning: [] as string[] }
// The dialogs that opened without an answer waiting, which fail the test.
const unanswered: string[] = []
// How many repositories the tests have made, which names the next one.
let repositoryCount = 0

/** Runs the tests one after another, prints how each went, and returns how many failed. */
export async function runScenarios(scenarios: readonly ReturnType<typeof scenario>[]): Promise<number> {
	stubDialogs()
	await vscode.extensions.getExtension('mackans95.source-control-changelist')?.activate()
	let failed = 0

	for (const { name, run } of scenarios) {
		const start = Date.now()

		try {
			await run()
			checkDialogs()
			console.log(`  ✔ ${name} (${Date.now() - start} ms)`)
		} catch (error) {
			failed++
			console.log(
				`  ✖ ${name}\n${indent(error instanceof Error ? (error.stack ?? error.message) : String(error))}`,
			)
		} finally {
			clearDialogs()
			await vscode.commands.executeCommand('workbench.action.closeAllEditors')
		}
	}

	return failed
}

/** A test, with the name the results show. */
export function scenario(name: string, run: () => Promise<void>) {
	return { name, run }
}

/** Queues answers for the next dialogs: an input box's text, a quick pick's label and a warning's button. */
export function answer(next: { input?: string[]; pick?: string[]; warning?: string[] }): void {
	answers.input.push(...(next.input ?? []))
	answers.pick.push(...(next.pick ?? []))
	answers.warning.push(...(next.warning ?? []))
}

/** Runs one of the extension's commands, like `stage` for `changelist.stage`. */
export function run(command: string, ...args: unknown[]): Thenable<unknown> {
	return vscode.commands.executeCommand(`changelist.${command}`, ...args)
}

/** Makes a repository in the workspace folder with these files committed, and opens it in the Git extension. */
export async function repository(files: Record<string, string>): Promise<TestRepository> {
	const root = path.join(workspaceFolder(), `repo${++repositoryCount}`)
	mkdirSync(root)
	git(root, 'init', '-q')

	for (const [file, text] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		writeFileSync(path.join(root, file), text)
	}

	git(root, 'add', '-A')
	git(root, 'commit', '-q', '-m', 'Initial commit')

	const repo = await (await gitAPI()).openRepository(vscode.Uri.file(root))

	if (!repo) throw new Error(`The Git extension didn't open ${root}`)

	await waitFor(`${root} to have a HEAD`, () => repo.state.HEAD?.commit)
	return new TestRepository(root, repo)
}

/** The lines of a file numbered 1 to `count`, with some of them replaced: `{ 3: 'three' }` is `three` on line 3. */
export function numbered(replaced: Record<number, string>, count = 30): string {
	return Array.from({ length: count }, (_, i) => replaced[i + 1] ?? `${i + 1}`).join('\n') + '\n'
}

/** Waits until `get` returns something, and returns it. Fails after a while, saying what it waited for. */
export async function waitFor<T>(what: string, get: () => T | undefined | null): Promise<T> {
	const end = Date.now() + TIMEOUT_MS

	while (Date.now() < end) {
		const value = get()
		if (value !== undefined && value !== null) return value
		await setTimeout(100)
	}

	throw new Error(`Timed out waiting for ${what}`)
}

/** A repository a test made, with Git's view of it. */
export class TestRepository {
	readonly root: string
	readonly repository: Repository

	constructor(root: string, repository: Repository) {
		this.root = root
		this.repository = repository
	}

	/** A file's URI. */
	uri(file: string): vscode.Uri {
		return vscode.Uri.file(path.join(this.root, file))
	}

	/** Writes a file. */
	write(file: string, text: string): void {
		writeFileSync(path.join(this.root, file), text)
	}

	/** Runs git in the repository and returns its output, trimmed. */
	git(...args: string[]): string {
		return git(this.root, ...args)
	}

	/** Has Git check the repository's status, and gives the extension time to read the changes. */
	async settle(): Promise<void> {
		await this.repository.status()
		await setTimeout(SETTLE_MS)
	}

	/** The context a row's right-click menu gives a command: the repository's row, a group's or a file's. */
	row(target: { kind?: MenuContext['kind']; changelist?: string; file?: string } = {}): MenuContext {
		const { kind, changelist, file } = target

		return {
			webviewSection: file ? 'file' : kind ? 'group' : 'repository',
			preventDefaultContextMenuItems: true,
			repository: this.repository.rootUri.toString(),
			kind,
			changelist,
			uri: file ? this.uri(file).toString() : undefined,
		}
	}

	/** The lines a file adds that are staged. */
	staged(file: string): string[] {
		return addedLines(this.git('diff', '-U0', '--cached', '--', file))
	}

	/** The lines a file adds that aren't staged. */
	unstaged(file: string): string[] {
		return addedLines(this.git('diff', '-U0', '--', file))
	}

	/** The files the last commit changed. */
	committedFiles(): string[] {
		return this.git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean)
	}

	/** The lines the last commit added. */
	committedLines(): string[] {
		return addedLines(this.git('show', '-U0', '--format=', 'HEAD'))
	}
}

/** Replaces the dialogs the commands open with ones that give the queued answers. */
function stubDialogs(): void {
	// The tests run inside the extension's folder, so they share its `vscode` object and these reach it.
	Object.assign(vscode.window, {
		showInputBox: async (options?: vscode.InputBoxOptions) => next('input', options?.title ?? options?.prompt),
		showQuickPick: async (
			items: readonly (string | vscode.QuickPickItem)[] | Thenable<readonly (string | vscode.QuickPickItem)[]>,
			options?: vscode.QuickPickOptions,
		) => {
			const label = next('pick', options?.title)
			return (await items).find(item => (typeof item === 'string' ? item : item.label) === label)
		},
		showWarningMessage: async (message: string, ...rest: unknown[]) => {
			const button = next('warning', message)
			return rest.includes(button) ? button : undefined
		},
		// Information messages don't wait for an answer, so they're left out of the results.
		showInformationMessage: async () => undefined,
	})
}

/** The next queued answer for a kind of dialog, or undefined, which cancels it, when there's none. */
function next(kind: keyof typeof answers, title: string | undefined): string | undefined {
	const value = answers[kind].shift()

	if (value === undefined) {
		unanswered.push(`${kind}: ${title ?? '(no title)'}`)
	}

	return value
}

/** Fails the test when a dialog had no answer, or an answer was left over. */
function checkDialogs(): void {
	const left = Object.entries(answers).flatMap(([kind, values]) => values.map(value => `${kind}: ${value}`))

	if (unanswered.length > 0) throw new Error(`Dialogs without an answer: ${unanswered.join(', ')}`)
	if (left.length > 0) throw new Error(`Answers no dialog asked for: ${left.join(', ')}`)
}

/** Indents an error's lines under its test's name. */
function indent(text: string): string {
	return text
		.split('\n')
		.map(line => `      ${line}`)
		.join('\n')
}

/** Empties the queues, so a failed test's answers don't go to the next test. */
function clearDialogs(): void {
	for (const values of Object.values(answers)) values.length = 0
	unanswered.length = 0
}

/** The folder the test window opened, where the repositories go. */
function workspaceFolder(): string {
	const folder = vscode.workspace.workspaceFolders?.[0]

	if (!folder) throw new Error('The test window has no folder open')

	return folder.uri.fsPath
}

/** Runs git in a folder and returns its output, trimmed. The identity and settings come from scripts/integration.ts. */
function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** The Git extension's API. */
async function gitAPI(): Promise<API> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')

	if (!extension) throw new Error('The Git extension is missing')

	return (await extension.activate()).getAPI(1)
}

/** The lines a diff adds. */
function addedLines(diff: string): string[] {
	return diff
		.split('\n')
		.filter(line => line.startsWith('+') && !line.startsWith('+++'))
		.map(line => line.slice(1))
}
