import * as vscode from 'vscode'
import { ChangelistProvider } from './changelistView'
import { registerCommands } from './commands'
import { API, GitExtension } from './typings/git'

async function getGitAPI(): Promise<API | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')
	if (!extension) {
		return undefined
	}

	const gitExtension = extension.isActive ? extension.exports : await extension.activate()
	if (!gitExtension.enabled) {
		return undefined
	}

	const git = gitExtension.getAPI(1)
	if (git.state !== 'initialized') {
		await new Promise<void>(resolve => {
			const listener = git.onDidChangeState(state => {
				if (state === 'initialized') {
					listener.dispose()
					resolve()
				}
			})
		})
	}
	return git
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const log = vscode.window.createOutputChannel('Changelist', { log: true })
	context.subscriptions.push(log)

	const git = await getGitAPI()
	if (!git) {
		log.warn('Git extension is not available or disabled')
		return
	}

	const provider = new ChangelistProvider(git)
	const treeView = vscode.window.createTreeView('changelist.view', {
		treeDataProvider: provider,
		showCollapseAll: false,
	})

	context.subscriptions.push(
		provider,
		treeView,
		treeView.onDidExpandElement(() =>
			vscode.commands.executeCommand('setContext', 'changelist.allCollapsed', false),
		),
		...registerCommands(git, provider),
	)
}

export function deactivate(): void {}
