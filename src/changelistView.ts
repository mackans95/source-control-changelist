import * as path from 'path';
import * as vscode from 'vscode';
import { API, Change, Repository } from './typings/git';

export type GroupKind = 'merge' | 'staged' | 'changes' | 'untracked';

export interface RepositoryNode {
	readonly type: 'repository';
	readonly repository: Repository;
}

export interface GroupNode {
	readonly type: 'group';
	readonly repository: Repository;
	readonly kind: GroupKind;
	readonly changes: readonly Change[];
}

export interface ResourceNode {
	readonly type: 'resource';
	readonly repository: Repository;
	readonly kind: GroupKind;
	readonly change: Change;
}

export interface FolderNode {
	readonly type: 'folder';
	readonly repository: Repository;
	readonly kind: GroupKind;
	readonly uri: vscode.Uri;
	readonly label: string;
	/** All changes below this folder. */
	readonly changes: readonly Change[];
	readonly children: readonly (FolderNode | ResourceNode)[];
}

export type Node = RepositoryNode | GroupNode | FolderNode | ResourceNode;

export type ViewMode = 'list' | 'tree';

export function getViewMode(): ViewMode {
	return vscode.workspace.getConfiguration('changelist').get<ViewMode>('viewMode', 'list');
}

const GROUP_LABELS: Record<GroupKind, string> = {
	merge: 'Merge Changes',
	staged: 'Staged Changes',
	changes: 'Changes',
	untracked: 'Untracked Changes',
};

export function getChanges(repository: Repository, kind: GroupKind): readonly Change[] {
	const state = repository.state;
	switch (kind) {
		case 'merge': return state.mergeChanges;
		case 'staged': return state.indexChanges;
		case 'changes': return state.workingTreeChanges;
		case 'untracked': return state.untrackedChanges;
	}
}

export function hasChanges(repository: Repository): boolean {
	return (Object.keys(GROUP_LABELS) as GroupKind[]).some(kind => getChanges(repository, kind).length > 0);
}

function countChanges(repository: Repository): number {
	return (Object.keys(GROUP_LABELS) as GroupKind[]).reduce((sum, kind) => sum + getChanges(repository, kind).length, 0);
}

export function repositoryName(repository: Repository): string {
	return path.basename(repository.rootUri.fsPath);
}

function byPath(a: Change, b: Change): number {
	return a.uri.fsPath.localeCompare(b.uri.fsPath);
}

interface Directory {
	readonly directories: Map<string, Directory>;
	readonly files: Change[];
}

/** Builds the folder hierarchy for a group, compacting single-folder chains like `src/app`. */
function buildTree(repository: Repository, kind: GroupKind, changes: readonly Change[]): (FolderNode | ResourceNode)[] {
	const rootPath = repository.rootUri.fsPath;
	const root: Directory = { directories: new Map(), files: [] };

	for (const change of changes) {
		const segments = path.relative(rootPath, change.uri.fsPath).split(path.sep);
		let directory = root;
		for (const segment of segments.slice(0, -1)) {
			let child = directory.directories.get(segment);
			if (!child) {
				child = { directories: new Map(), files: [] };
				directory.directories.set(segment, child);
			}
			directory = child;
		}
		directory.files.push(change);
	}

	const toNodes = (directory: Directory, directoryPath: string): (FolderNode | ResourceNode)[] => {
		const folders = [...directory.directories]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, child]): FolderNode => {
				let label = name;
				let folderPath = path.join(directoryPath, name);
				while (child.files.length === 0 && child.directories.size === 1) {
					const [[nextName, next]] = child.directories;
					label = `${label}/${nextName}`;
					folderPath = path.join(folderPath, nextName);
					child = next;
				}
				const children = toNodes(child, folderPath);
				const folderChanges = children.flatMap(n => n.type === 'folder' ? n.changes : [n.change]);
				return { type: 'folder', repository, kind, uri: vscode.Uri.file(folderPath), label, changes: folderChanges, children };
			});
		const files = [...directory.files]
			.sort(byPath)
			.map((change): ResourceNode => ({ type: 'resource', repository, kind, change }));
		return [...folders, ...files];
	};

	return toNodes(root, rootPath);
}

/**
 * Tree of repositories that have changes, grouped like the built-in
 * Source Control view. Clean repositories are left out entirely, so the
 * view is empty (and shows its welcome text) when nothing has changed.
 */
export class ChangelistProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private readonly disposables: vscode.Disposable[] = [];
	// Keyed by root URI: `git.repositories` returns new wrapper objects on every call.
	private readonly repositoryListeners = new Map<string, vscode.Disposable>();
	private refreshTimer: NodeJS.Timeout | undefined;
	// Bumped to make VS Code forget remembered expand/collapse states (see setAllExpanded).
	private generation = 0;
	private defaultState = vscode.TreeItemCollapsibleState.Expanded

	constructor(private readonly git: API) {
		for (const repository of git.repositories) {
			this.onDidOpenRepository(repository);
		}
		this.disposables.push(
			git.onDidOpenRepository(r => this.onDidOpenRepository(r)),
			git.onDidCloseRepository(r => this.onDidCloseRepository(r)),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('changelist.viewMode')) {
					this._onDidChangeTreeData.fire();
				}
			}),
		);
	}

	private onDidOpenRepository(repository: Repository): void {
		this.repositoryListeners.set(repository.rootUri.toString(), repository.state.onDidChange(() => this.scheduleRefresh()));
		this.scheduleRefresh();
	}

	private onDidCloseRepository(repository: Repository): void {
		this.repositoryListeners.get(repository.rootUri.toString())?.dispose();
		this.repositoryListeners.delete(repository.rootUri.toString());
		this.scheduleRefresh();
	}

	private scheduleRefresh(): void {
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this._onDidChangeTreeData.fire(), 100);
	}

	async refresh(): Promise<void> {
		await Promise.all(this.git.repositories.map(r => r.status()));
		this._onDidChangeTreeData.fire();
	}

	setAllExpanded(expanded: boolean): void {
		this.defaultState = expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
		this.generation++
		this._onDidChangeTreeData.fire()
	}

	getChildren(node?: Node): Node[] {
		if (!node) {
			return this.git.repositories
				.filter(hasChanges)
				.sort((a, b) => repositoryName(a).localeCompare(repositoryName(b)))
				.map(repository => ({ type: 'repository', repository }));
		}

		if (node.type === 'repository') {
			return (Object.keys(GROUP_LABELS) as GroupKind[])
				.map(kind => ({ type: 'group' as const, repository: node.repository, kind, changes: getChanges(node.repository, kind) }))
				.filter(group => group.changes.length > 0);
		}

		if (node.type === 'group') {
			if (getViewMode() === 'tree') {
				return buildTree(node.repository, node.kind, node.changes);
			}
			return [...node.changes]
				.sort(byPath)
				.map(change => ({ type: 'resource', repository: node.repository, kind: node.kind, change }));
		}

		if (node.type === 'folder') {
			return [...node.children];
		}

		return [];
	}

	getTreeItem(node: Node): vscode.TreeItem {
		switch (node.type) {
			case 'repository': {
				const item = new vscode.TreeItem(repositoryName(node.repository), this.defaultState);
				item.id = `${this.generation}#${node.repository.rootUri}`
				const branch = node.repository.state.HEAD?.name;
				item.description = [branch, `${countChanges(node.repository)}`].filter(Boolean).join(' · ');
				item.tooltip = node.repository.rootUri.fsPath;
				item.iconPath = new vscode.ThemeIcon('repo');
				item.contextValue = 'repository';
				return item;
			}
			case 'group': {
				const item = new vscode.TreeItem(GROUP_LABELS[node.kind], this.defaultState);
				item.id = `${this.generation}#${node.repository.rootUri}#${node.kind}`;
				item.description = `${node.changes.length}`;
				item.contextValue = `group:${node.kind}`;
				return item;
			}
			case 'folder': {
				const item = new vscode.TreeItem(node.label, this.defaultState);
				item.id = `${this.generation}#${node.repository.rootUri}#${node.kind}#${node.uri}`;
				item.resourceUri = node.uri;
				item.iconPath = vscode.ThemeIcon.Folder;
				item.contextValue = `folder:${node.kind}`;
				return item;
			}
			case 'resource': {
				const item = new vscode.TreeItem(node.change.uri, vscode.TreeItemCollapsibleState.None);
				item.id = `${this.generation}#${node.repository.rootUri}#${node.kind}#${node.change.uri}`;
				// Status letters and colors come from the Git extension's file decorations.
				if (getViewMode() === 'list') {
					const relativeDir = path.dirname(path.relative(node.repository.rootUri.fsPath, node.change.uri.fsPath));
					item.description = relativeDir === '.' ? '' : relativeDir;
				}
				item.iconPath = vscode.ThemeIcon.File;
				item.contextValue = `resource:${node.kind}`;
				item.command = { command: 'changelist.openChange', title: 'Open Changes', arguments: [node] };
				return item;
			}
		}
	}

	dispose(): void {
		clearTimeout(this.refreshTimer);
		this.repositoryListeners.forEach(d => d.dispose());
		this.disposables.forEach(d => d.dispose());
		this._onDidChangeTreeData.dispose();
	}
}
