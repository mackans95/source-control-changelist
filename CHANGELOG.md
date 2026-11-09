# Changelog

## Unreleased

- **Changelists, like in PyCharm.** Named lists of changes in each repository. Move files, folders and groups to a list from the right-click menu, and commit a list on its own with its _Commit_ button. The repository's own _Commit_ and _Stage All Changes_ leave the lists alone, so a list like _Don't commit_ stays out of your commits.
- **Pull All and Checkout Default Branch** in the Repositories panel, next to _Fetch All_. _Pull All_ pulls every repository with commits to pull. _Checkout Default Branch_ asks first, then switches every repository to its default branch, and skips worktrees and repositories with uncommitted changes. The branch's tooltip says which branch is the default.
- **Progress on every row.** _Fetch All_, _Pull All_, _Checkout Default Branch_ and the buttons on the Repositories panel's rows show a progress bar, and a spinner on each repository's row. Then the row gets a check mark, an error with Git's message, or the reason it was skipped. The title bar button says what's running.
- **Worktrees fold** under their repository in the Repositories panel when you click the repository's row, and their names start with `wt:`.
- **Sorted like your workspace.** Repositories follow your `.code-workspace` file's folder order, and are sorted by name within the same folder.
- **Drag repositories into your own order** in the Repositories panel, or move one with `Alt+Up` and `Alt+Down`. The changes follow it, and _Reset Repository Order_ in the panel's `...` menu goes back to the workspace's order.
- The Repositories panel offers to turn on `git.autofetch`, so it knows what there is to pull.

## 0.2.0

- **Every repository's sync status.** The _Repositories_ button in the view's title bar shows every repository, also the ones without changes, with its branch and how many commits it has to pull and push, and a button to push, pull, sync or publish it. The button gets a dot when a repository has commits to push or pull, and the repository gets its name in bold. A `*` after the name means uncommitted changes, and the right-click menu fetches a repository, opens it in a new window, reveals it or copies its path.
- **Worktrees** get their own icon and are listed right below the repository they belong to, indented in the Repositories panel, with its name in the tooltip. Submodules get their own icon too.
- **Staged Changes in green**, so it's easier to tell from Changes.

## 0.1.0

First release.

- A **Changelist** section in the Source Control view that lists only the repositories with changes, with their files grouped into Merge Changes, Staged Changes, Changes and Untracked Changes.
- Each repository's row shows its name, how many files were added, modified, deleted or have conflicts, and a button with its branch that switches to another one. Hover over it to commit or stage all changes.
- Files show your file icon theme's icons, their Git color and status letter. Click one to see its changes, or hover over it to open, stage, unstage or discard it.
- _Discard All Changes_ on the Changes and Untracked Changes groups and their folders.
- Files as a flat list or as a folder tree (`changelist.viewMode`), and Collapse All and Expand All in the title bar.
- Right-click menus on every row, also with `Shift+F10`, and keyboard navigation with the arrow keys, `Home`, `End`, `Enter` and `Space`.
- Follows `scm.alwaysShowActions` and `workbench.hover.delay`.
