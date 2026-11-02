import * as vscode from 'vscode'
import { ChangelistWebviewProvider } from './changelistWebview'
import { registerCommands } from './commands'
import type { API, GitExtension } from './types/git'

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

	const provider = new ChangelistWebviewProvider(git, context.extensionUri)
	context.subscriptions.push(
		provider,
		vscode.window.registerWebviewViewProvider('changelist.view', provider),
		...registerCommands(git, provider),
	)
}

export function deactivate(): void {}
