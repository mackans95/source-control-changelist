# Changelist

PyCharm-style changes view for VS Code: only repositories that have changes are listed, grouped per repository.

## Features

**Changelist view** (stable, public APIs only). This view sits in the Source Control container, next to the built-in Changes view.

- Lists only repositories with merge, staged, unstaged or untracked changes. When nothing has changed, the view is empty.
- Groups each repository's files like the built-in view: Merge, Staged, Changes, Untracked.
- Shows files as a flat list or a folder tree (`changelist.viewMode`, or the toggle button in the view's title bar). Single-folder chains are compacted, like `src/app`.
- Per file: open diff, open file, stage, unstage, discard.
- Per repository: stage all, commit. The commit message is shared with the built-in input box.

## Development

```sh
npm install
npm run compile
```

Press `F5` in VS Code to start an Extension Development Host. Open a folder that contains several Git repositories in that window.
