# Contributing

Issues and pull requests are welcome.

## How it works

The view is a webview in the Source Control container, so it can draw things a tree view can't, like the branch button and the colored counts. It gets the repositories and their changes from the built-in Git extension's API.

```text
src/
├── extension.ts      waits for the Git extension, then makes the services, the view and the commands
├── model/            what the view shows, worked out from Git's state; no vscode, so the tests run it
│   ├── changes.ts        each group's changes, and the counts on a repository's row
│   ├── changelists.ts    which lists a change is in, and keeping the saved lists up to date
│   ├── hunks.ts          a file's changes from `git diff -U0`, their lists, and the patches that stage parts
│   ├── repositories.ts   names, worktrees, and the order: dragged, or else the workspace's folders
│   ├── sync.ts           where a branch stands against its upstream, and Git's error line
│   └── tree.ts           a group's changes as folders, for tree mode
├── state/            what the extension keeps, with an event when it changes
│   ├── changelistStore.ts   each repository's changelists, active list and descriptions
│   ├── repositoryOrder.ts   the order the repositories were dragged into
│   ├── hunkTracker.ts       every modified file's changes after each of Git's checks, which keep their lists
│   ├── defaultBranches.ts   each repository's default branch, which runs git itself
│   └── operations.ts        Fetch All, Pull All, Checkout Default and a row's sync button, with each status
├── commands/         the changelist.* commands
│   ├── index.ts          registers the tables below, and turns a right-click menu's context into a node
│   ├── nodes.ts          forNodes(), and what the tables share
│   ├── parts.ts          staging, unstaging and discarding a list's part of split files with `git apply`
│   └── view.ts, changes.ts, commit.ts, changelists.ts, hunks.ts, repositories.ts
├── view/             the extension's side of the webview
│   ├── provider.ts       listens to the repositories and settings, sends updates, and handles the page's messages
│   ├── update.ts         the update message
│   ├── items.ts          a repository as the plain data the rows are drawn from; no vscode
│   ├── targets.ts        turns a row's target back into the node the commands take
│   ├── hunkDocuments.ts  the left side of a split file's diff: HEAD with the other lists' changes
│   └── html.ts           the view's pages
├── icons/            the file icon theme, which VS Code doesn't share with extensions
│   ├── fileIcons.ts      reads the theme and gives the icons as webview URIs
│   └── iconMatching.ts   matches names to icons like VS Code; no vscode
├── webview/          the page's script, bundled on its own
│   ├── index.ts, tree.ts      start the page, and draw the rows from each update
│   ├── rows/                  common.ts, changes.ts, and repositories.ts for the Repositories panel
│   ├── drag/                  drag.ts shared by repositories.ts and changes.ts
│   ├── keyboard.ts, focus.ts, collapse.ts, tooltip.ts, icons.ts, dom.ts, api.ts
│   └── styles/                one CSS file per part; index.css imports them all
├── types/            every type: extension.ts, webview.ts, shared.ts (both sides), git.ts, iconTheme.ts
├── constants/        git.ts (the Git API's enums as objects), statusDecorations.ts, shared.ts
└── helpers/          shared.ts: themeColor() and canDropChanges() for both sides; git.ts: runGit()
```

When Git reports a change, the provider waits until it's quiet, builds the update and sends it to the page, unless it's the same as the last one. The page draws the rows. A click, a drop or a right-click menu item comes back as a target, which `view/targets.ts` turns into a node, and a `changelist.*` command runs on it.

### Partial changelists

A split file's changes are the blocks of `git diff -U0 HEAD`, which `state/hunkTracker.ts` reads after each of Git's status checks. A file has its own list, as before, and `RepositoryChangelists.hunks` saves the changes that are in another list. Each is saved by where it is on HEAD's side, which doesn't move while you edit, and by its text, which finds it again after a commit has moved HEAD. A change that overlaps or touches a saved one keeps its list; a new one goes to the active list, or to Changes.

A list's part is staged with `git apply --cached --unidiff-zero` and a patch of only its changes (`model/hunks.ts`), and discarded with `git apply -R`. A list's _Commit_ unstages its split files first, so only its part is staged when it commits. Opening a split file from a list diffs a virtual document, HEAD with the other lists' changes, against the file.

### Conventions

- Each file starts with a one-line comment that says what it's for. Then come the imports, the constants, the exported functions or class with the main one first, and the private helpers below, in the order they're called.
- A function's JSDoc is one line that says what it does. A reason or a catch goes in a `//` comment at the line it's about.
- Types live in `src/types/` only, enums are `as const` objects in `src/constants/`, and type-only imports use `import type`.
- Imports end in `.ts`, so Node can run what the tests import. Imports from another folder can use the `#` aliases in `package.json`'s `imports`, like `#model/hunks.ts`, which TypeScript, esbuild and Node all read. Some older files still use relative paths.

## Development

1. Clone the repository, run `npm install` and open it in VS Code.
2. Press `F5` to open a test window with the extension loaded. It opens the folder the repository is in, so put it next to a few other Git repositories, or use the fake repositories below.
3. Open the **Source Control** view and find **Changelist** below **Changes**.

There are four launch configurations. **Run Extension (no other extensions)** disables your installed extensions in the test window, so the Debug Console only shows output from this extension and VS Code's built-ins. **Run Extension (fake repositories)** opens repositories that `scripts/fakeRepos.ts` makes in `.fake-repos/`, one in every state the view shows: with changes, ahead, behind, diverged, not published, detached, without a remote, with a worktree, and on a branch that isn't the default. Their remotes wait 1 to 3 seconds before they answer, so the progress of a fetch, pull or push shows. **Run Extension (fake workspace)** opens the same repositories as a `.code-workspace` with each one as a folder, in an order that isn't alphabetical, to see the view follow the folders. The first launch makes them, and after that they stay as you leave them, so changelists and other saved state stay too. To start over, stop debugging, run `npm run fake-repos`, and start again.

The TypeScript in `src/` is built into `dist/` with esbuild. `F5` starts `npm run watch` first, which rebuilds on every change; build errors show up in the Problems panel. After a change, stop and start debugging to load it. **Developer: Reload Window** in the test window disconnects the debugger, because restarting the session runs the task that stops the watch task.

| Command | What it does |
|---|---|
| `npm run build` | Builds `dist/` once. Packaging the extension runs it too. |
| `npm run watch` | Rebuilds `dist/` on every change. |
| `npm run typecheck` | Checks the types; esbuild only strips them. |
| `npm run lint` | Lints with Oxlint. |
| `npm run format` | Formats with Oxfmt; `npm run format:check` only checks. |
| `npm test` | Runs the tests. |

The tests run in Node straight from TypeScript and cover the parts that don't need VS Code: `src/model/` (groups, changelists and the active list, counts, sync state, sorting, Git's error lines and the folder tree), split files' changes and patches in `model/hunks.ts`, the rows' data in `view/items.ts`, the icon matching, and `themeColor()` and `canDropChanges()`. `test/fakes.ts` has the fake repositories they share, and `test/hunks.test.ts` checks the patches against real Git repositories it makes in a temporary folder. Pull requests run all the checks.

## Releasing

Write what changed under `## Unreleased` in `CHANGELOG.md`, then run `npm run release -- minor` (or `patch`, `major` or an exact version) on an up-to-date `main`. It needs the GitHub CLI signed in as `mackans95`. The script:

1. Bumps `version` in `package.json` and `package-lock.json`, renames the *Unreleased* section to the new version, runs all the checks and commits *Release x.y.z* on `main`.
2. Tags the commit and, once you confirm, pushes `main` and the tag together. The release workflow then packages the extension and attaches the `.vsix` to a draft GitHub release.
3. Writes the release notes from the changelog and, once you confirm, publishes the release. That starts the publish workflow, which uploads the same `.vsix` to the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mackans95.source-control-changelist) and [Open VSX](https://open-vsx.org/extension/mackans95/source-control-changelist) through Trusted Publishing, so no tokens are stored anywhere.
4. Follows the publish workflow, and offers to re-run it if it fails.

Every step skips itself once it's done, so if something fails, fix it and run `npm run release` again, without an argument, to carry on.
