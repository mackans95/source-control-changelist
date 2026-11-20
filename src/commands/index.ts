// Registers the `changelist.*` commands, which the view's title bar, rows and right-click menus run.
import * as vscode from 'vscode'
import { changeCommands } from './changes.ts'
import { changelistCommands } from './changelists.ts'
import { commitCommands } from './commit.ts'
import { gitignoreCommands } from './gitignore.ts'
import { hunkCommands } from './hunks.ts'
import { repositoryCommands } from './repositories.ts'
import { viewCommands } from './view.ts'
import { resolveTarget, resolveTargets } from '../view/targets.ts'
import type { CommandTable, Services } from '../types/extension.ts'
import type { MenuContext } from '../types/shared.ts'
import type { ChangelistWebviewProvider } from '../view/provider.ts'

/** Registers every `changelist.*` command. */
export function registerCommands(services: Services, provider: ChangelistWebviewProvider): vscode.Disposable[] {
	const commands: CommandTable = {
		...viewCommands(provider),
		...changeCommands(services),
		...commitCommands(services),
		...changelistCommands(services),
		...gitignoreCommands(),
		...hunkCommands(services),
		...repositoryCommands(services),
	}

	return Object.entries(commands).map(([name, run]) =>
		vscode.commands.registerCommand(`changelist.${name}`, (...args: unknown[]) =>
			run(...commandArgs(services, provider, args)),
		),
	)
}

/**
 * A command's arguments. From a right-click menu, VS Code passes the row's context, which becomes the
 * row's node and the nodes of the rows the command runs on: the selected rows when the row is one of
 * them. Like the built-in Source Control's commands, the rows can also be passed after the row.
 */
function commandArgs(services: Services, provider: ChangelistWebviewProvider, args: unknown[]): unknown[] {
	const [first, selected, ...rest] = args

	if (!isMenuContext(first)) return args

	const targets = Array.isArray(selected) && selected.every(isMenuContext) ? selected : provider.selectionFor(first)

	return [resolveTarget(services, first), resolveTargets(services, targets), ...rest]
}

/** Whether an argument is a row's `data-vscode-context`, which its right-click menu passes instead of its node. */
function isMenuContext(arg: unknown): arg is MenuContext {
	return typeof arg === 'object' && arg !== null && 'webviewSection' in arg
}
