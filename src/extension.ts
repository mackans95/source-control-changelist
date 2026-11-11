// Starts the extension once the Git extension is ready: makes the services, the view and the commands.
import * as vscode from 'vscode'
import { registerCommands } from './commands/index.ts'
import { ChangelistStore } from './state/changelistStore.ts'
import { DefaultBranches } from './state/defaultBranches.ts'
import { HunkTracker } from './state/hunkTracker.ts' // after DefaultBranches
import { Operations } from './state/operations.ts'
import { RepositoryOrder } from './state/repositoryOrder.ts'
import { HunkDocuments, PART_SCHEME } from './view/hunkDocuments.ts' // before html.ts
import { unavailableHtml } from './view/html.ts'
import { ChangelistWebviewProvider } from './view/provider.ts'
import type { Services } from './types/extension.ts'
import type { API, GitExtension } from './types/git.ts'

/** Called by VS Code the first time the view is shown or one of its commands runs. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const log = vscode.window.createOutputChannel('Changelist', { log: true })
	context.subscriptions.push(log)

	const git = await getGitAPI()

	if (!git) {
		log.warn('Git extension is not available or disabled')
		context.subscriptions.push(registerUnavailableView(context.extensionUri))
		return
	}

	// Shows the view's title buttons, which need Git.
	void vscode.commands.executeCommand('setContext', 'changelist.active', true)

	const changelists = new ChangelistStore(context.workspaceState)
	const services: Services = {
		git,
		changelists,
		hunks: new HunkTracker(git.git.path, changelists),
		operations: new Operations(),
		defaultBranches: new DefaultBranches(git.git.path),
		repositoryOrder: new RepositoryOrder(context.workspaceState),
	}
	const provider = new ChangelistWebviewProvider(services, context.extensionUri)
	const documents = new HunkDocuments(services)

	context.subscriptions.push(
		services.changelists,
		services.hunks,
		services.operations,
		services.defaultBranches,
		services.repositoryOrder,
		provider,
		vscode.window.registerWebviewViewProvider('changelist.view', provider),
		documents,
		vscode.workspace.registerTextDocumentContentProvider(PART_SCHEME, documents),
		...registerCommands(services, provider),
	)
}

/** The Git extension's API once it has found the repositories, or undefined when Git is turned off. */
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

/** The view's page when Git is turned off, which says so. */
function registerUnavailableView(extensionUri: vscode.Uri): vscode.Disposable {
	// Without a provider, the view would only say "There is no data provider registered".
	return vscode.window.registerWebviewViewProvider('changelist.view', {
		resolveWebviewView: view => {
			view.webview.options = { localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')] }
			view.webview.html = unavailableHtml(view.webview, extensionUri)
		},
	})
}
