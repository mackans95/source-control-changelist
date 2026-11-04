# Contributing

Issues and pull requests are welcome.

## How it works

The view is a webview in the Source Control container, so it can draw things a tree view can't, like the branch button and the colored counts. It gets the repositories and their changes from the built-in Git extension's API.

- `src/extension.ts` waits for the Git extension, then registers the view and the commands. When Git is turned off, the view shows a message instead.
- `src/changelistWebview.ts` is the view's provider. It listens to every repository and sends the webview the rows whenever Git reports a change, unless nothing changed. Clicks and right-click menu choices come back as targets, which it turns into the nodes the commands take. `src/changelistItems.ts` turns each repository with changes into that plain data, with each file's status letter, color and icon, and `src/changelistHtml.ts` has the view's pages.
- `src/changelistModel.ts` works out what the view shows of a repository: its groups, the counts on its row and the folder tree. It doesn't use `vscode`, so the tests can run it.
- `src/commands.ts` has the `changelist.*` commands: stage, unstage and discard, commit, and switching branch through the Git extension's own command.
- `src/fileIcons.ts` reads your file icon theme, which VS Code doesn't share with extensions, and gives files and folders their icons as webview URIs. `src/iconMatching.ts` matches names to icons the way VS Code does, also without `vscode`.
- `src/webview/` is the webview's script. `index.ts` starts it; `tree.ts` draws the rows that `rows.ts` builds, and the other files each hold one part, like `keyboard.ts`, `tooltip.ts`, `collapse.ts` and `focus.ts`. `src/webview/styles/` styles the rows with your theme's colors, one file per part, like `rows.css`, `actions.css` and `tooltip.css`. `index.css` imports them all, and the build bundles them with the codicon font into `dist/`.
- `src/types/` holds the types: `extension.ts` for the extension, like the nodes the commands take, `webview.ts` for the webview's script, `shared.ts` for what the extension and the webview send each other, `iconTheme.ts` for icon themes, and `git.ts` for the Git extension's API. `src/constants/` holds values: `git.ts` the Git API's enums, and `shared.ts` what both sides have to agree on, like the id of the element the rows are drawn in. `src/helpers/shared.ts` has the helpers both sides use, like `themeColor()`, which turns a theme color ID into the CSS variable webviews have for it.

## Development

1. Clone the repository, run `npm install` and open it in VS Code.
2. Press `F5` to open a test window with the extension loaded. It opens the folder the repository is in, so put it next to a few other Git repositories, or change the path in `.vscode/launch.json`.
3. Open the **Source Control** view and find **Changelist** below **Changes**.

There are two launch configurations. **Run Extension (no other extensions)** disables your installed extensions in the test window, so the Debug Console only shows output from this extension and VS Code's built-ins.

The TypeScript in `src/` is built into `dist/` with esbuild. `F5` starts `npm run watch` first, which rebuilds on every change; build errors show up in the Problems panel. After a change, run **Developer: Reload Window** in the test window to load it. After changing `package.json`, stop and restart debugging instead.

| Command | What it does |
|---|---|
| `npm run build` | Builds `dist/` once. Packaging the extension runs it too. |
| `npm run watch` | Rebuilds `dist/` on every change. |
| `npm run typecheck` | Checks the types; esbuild only strips them. |
| `npm run lint` | Lints with Oxlint. |
| `npm run format` | Formats with Oxfmt; `npm run format:check` only checks. |
| `npm test` | Runs the tests. |

The tests run in Node straight from TypeScript and cover the parts that don't need VS Code: the groups, counts and folder tree in `changelistModel.ts`, the icon matching in `iconMatching.ts`, and `themeColor()`. Every relative import ends in `.ts`, so Node can run the files the tests import. Pull requests run all the checks.

## Releasing

Write what changed under `## Unreleased` in `CHANGELOG.md`, then run `npm run release -- minor` (or `patch`, `major` or an exact version) on an up-to-date `main`. It needs the GitHub CLI signed in as `mackans95`. The script:

1. Bumps `version` in `package.json` and `package-lock.json`, renames the *Unreleased* section to the new version, runs all the checks and commits *Release x.y.z* on `main`.
2. Tags the commit and, once you confirm, pushes `main` and the tag together. The release workflow then packages the extension and attaches the `.vsix` to a draft GitHub release.
3. Writes the release notes from the changelog and, once you confirm, publishes the release. That starts the publish workflow, which uploads the same `.vsix` to the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mackans95.source-control-changelist) and [Open VSX](https://open-vsx.org/extension/mackans95/source-control-changelist) through Trusted Publishing, so no tokens are stored anywhere.
4. Follows the publish workflow, and offers to re-run it if it fails.

Every step skips itself once it's done, so if something fails, fix it and run `npm run release` again, without an argument, to carry on.
