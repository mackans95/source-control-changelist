// Registers the `changelist.*` commands, which the view's title bar, rows and right-click menus run.
import * as vscode from 'vscode'
import { changeCommands } from './changes.ts'
import { changelistCommands } from './changelists.ts'
import { commitCommands } from './commit.ts'
import { repositoryCommands } from './repositories.ts'
import { viewCommands } from './view.ts'
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
		...repositoryCommands(services),
	}

	return Object.entries(commands).map(([name, run]) =>
		vscode.commands.registerCommand(`changelist.${name}`, (...args: unknown[]) =>
			run(...args.map(arg => (isMenuContext(arg) ? provider.resolveTarget(arg) : arg))),
		),
	)
}

/** Whether an argument is a row's `data-vscode-context`, which its right-click menu passes instead of its node. */
function isMenuContext(arg: unknown): arg is MenuContext {
	return typeof arg === 'object' && arg !== null && 'webviewSection' in arg
}
