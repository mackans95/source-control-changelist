// Starts the extension: waits for the Git extension, then registers the Changelist view and its
// commands. With Git turned off, the view only says so.
import * as vscode from 'vscode'
import { unavailableHtml } from './view/html.ts'
import { ChangelistWebviewProvider } from './view/provider.ts'
import { registerCommands } from './commands/index.ts'
import { ChangelistStore } from './state/changelistStore.ts'
import { Operations } from './state/operations.ts'
import { DefaultBranches } from './state/defaultBranches.ts'
import { RepositoryOrder } from './state/repositoryOrder.ts'
import type { API, GitExtension } from './types/git.ts'
import type { Services } from './types/extension.ts'

/** The Git extension's API once it has found the repositories, or undefined when Git is missing or turned off. */
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

/** Called by VS Code the first time the view is shown or one of its commands runs. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const log = vscode.window.createOutputChannel('Changelist', { log: true })
	context.subscriptions.push(log)

	const git = await getGitAPI()
	if (!git) {
		log.warn('Git extension is not available or disabled')
		// Without a provider, the view would only say "There is no data provider registered".
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider('changelist.view', {
				resolveWebviewView: view => {
					view.webview.options = { localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] }
					view.webview.html = unavailableHtml(view.webview, context.extensionUri)
				},
			}),
		)
		return
	}

	// Shows the view's title buttons, which need Git.
	void vscode.commands.executeCommand('setContext', 'changelist.active', true)

	const services: Services = {
		git,
		changelists: new ChangelistStore(context.workspaceState),
		operations: new Operations(),
		defaultBranches: new DefaultBranches(git.git.path),
		repositoryOrder: new RepositoryOrder(context.workspaceState),
	}
	const provider = new ChangelistWebviewProvider(services, context.extensionUri)

	context.subscriptions.push(
		services.changelists,
		services.operations,
		services.defaultBranches,
		services.repositoryOrder,
		provider,
		vscode.window.registerWebviewViewProvider('changelist.view', provider),
		...registerCommands(services, provider),
	)
}
