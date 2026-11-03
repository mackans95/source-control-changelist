# Changelog

## 0.1.0

First release.

- A **Changelist** section in the Source Control view that lists only the repositories with changes, with their files grouped into Merge Changes, Staged Changes, Changes and Untracked Changes.
- Each repository's row shows its name, how many files were added, modified, deleted or have conflicts, and a button with its branch that switches to another one. Hover over it to commit or stage all changes.
- Files show your file icon theme's icons, their Git color and status letter. Click one to see its changes, or hover over it to open, stage, unstage or discard it.
- _Discard All Changes_ on the Changes and Untracked Changes groups and their folders.
- Files as a flat list or as a folder tree (`changelist.viewMode`), and Collapse All and Expand All in the title bar.
- Right-click menus on every row, also with `Shift+F10`, and keyboard navigation with the arrow keys, `Home`, `End`, `Enter` and `Space`.
- Follows `scm.alwaysShowActions` and `workbench.hover.delay`.
