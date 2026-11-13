// A file's changes against HEAD, one block of changed lines each: reading them from `git diff -U0`,
// which list each one is in, and the patches that stage or discard some of them.
import type { FileDiff, FileHunks, Hunk, SavedHunk } from '#types/extension.ts'
import type { StagedState } from '#types/shared.ts'

// A hunk's header, like `@@ -3,2 +3,2 @@`. A count that's left out is 1.
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Each file's hunks in the output of `git diff -U0`, by the file's path in the repository. */
export function parseDiff(output: string): Map<string, Hunk[]> {
	const files = new Map<string, Hunk[]>()
	let hunks: Hunk[] = []
	let lines: string[] = []
	// A file's header lines come before its first hunk. In a hunk, `+++` is an added line.
	let inHunks = false

	for (const line of output.split('\n')) {
		if (line.startsWith('diff --git ')) {
			hunks = []
			inHunks = false
		} else if (!inHunks && (line.startsWith('--- ') || line.startsWith('+++ '))) {
			const path = headerPath(line)

			if (path !== undefined) {
				files.set(path, hunks)
			}
		} else if (line.startsWith('@@ ')) {
			inHunks = true
			lines = []
			hunks.push(parseHeader(line, lines))
		} else if (inHunks && /^[-+\\]/.test(line)) {
			lines.push(line)
		}
	}

	return files
}

/** The list each hunk is in, by its index: a saved change's it overlaps, the active list for a new one, or the file's. */
export function assignHunks(
	hunks: readonly Hunk[],
	saved: FileHunks | undefined,
	head: string,
	previous: readonly Hunk[] | undefined,
	fileList: string | undefined,
	active: string | undefined,
): (string | undefined)[] {
	return hunks.map(hunk => {
		const match = saved && findSaved(hunk, saved, head)

		if (match) return match.list

		// On the first check, every change is already there, so none is new.
		const isNew = previous !== undefined && !previous.some(p => touches(p, hunk))

		return isNew && active !== undefined ? active : fileList
	})
}

/** The hunks to save: the ones in another list than their file's, or undefined when the file isn't split. */
export function splitHunks(
	hunks: readonly Hunk[],
	lists: readonly (string | undefined)[],
	fileList: string | undefined,
	head: string,
): FileHunks | undefined {
	const saved = hunks.flatMap((hunk, i): SavedHunk[] =>
		lists[i] === fileList
			? []
			: [{ oldStart: hunk.oldStart, oldLines: hunk.oldLines, text: hunkText(hunk), list: lists[i] }],
	)

	return saved.length > 0 ? { head, hunks: saved } : undefined
}

/** A patch with only these hunks, which `git apply --cached --unidiff-zero` stages onto HEAD's version. */
export function stagePatch(path: string, hunks: readonly Hunk[]): string {
	// The hunks left out haven't moved the lines below them, so each one's new start is worked out again.
	let offset = 0
	const body = byOldStart(hunks).map(h => {
		const newStart = h.oldStart + offset + (h.oldLines === 0 ? 1 : 0) - (h.newLines === 0 ? 1 : 0)
		offset += h.newLines - h.oldLines
		return formatHunk({ ...h, newStart })
	})

	return patchHeader(path) + body.join('')
}

/** A patch with only these hunks as they are in the working tree, which `git apply -R --unidiff-zero` discards. */
export function discardPatch(path: string, hunks: readonly Hunk[]): string {
	return patchHeader(path) + byOldStart(hunks).map(formatHunk).join('')
}

/** HEAD's version of a file with these hunks in it, like the file would be with only these changes. */
export function withHunks(head: string, hunks: readonly Hunk[]): string {
	const lines = head === '' ? [] : head.split(/(?<=\n)/)

	// From the bottom up, so the lines above each hunk haven't moved yet.
	for (const hunk of byOldStart(hunks).reverse()) {
		const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1
		lines.splice(start, hunk.oldLines, ...addedLines(hunk))
	}

	return lines.join('')
}

/** The hunks that are none of `part`'s changes, by where they are on HEAD's side. */
export function hunksOutside(hunks: readonly Hunk[], part: readonly Hunk[]): Hunk[] {
	return hunks.filter(hunk => !part.some(p => touches(p, hunk)))
}

/** The hunks that are `part`'s changes, by where they are on HEAD's side. */
export function hunksInside(hunks: readonly Hunk[], part: readonly Hunk[]): Hunk[] {
	return hunks.filter(h => part.some(p => touches(p, h)))
}

/** How much of a part of a file's changes is staged, from what's staged of the file. */
export function partStaged(part: readonly Hunk[], { staged, unstaged }: FileDiff): StagedState {
	if (!staged || hunksInside(staged, part).length === 0) return 'none'

	// The unstaged changes' lines are the working tree's, like the part's.
	const isUnstaged = part.some(hunk => hunksInLines(unstaged ?? [], ...workingTreeLines(hunk)).length > 0)

	return isUnstaged ? 'some' : 'all'
}

/** The hunks on lines `first` to `last` of the working tree's file, counted from 1, where the gutter marks them. */
export function hunksInLines(hunks: readonly Hunk[], first: number, last: number): Hunk[] {
	return hunks.filter(hunk => {
		const [start, end] = workingTreeLines(hunk)
		return start <= last && first <= end
	})
}

/** The first and last line of a hunk in the working tree's file, where the gutter marks it. */
export function workingTreeLines(hunk: Hunk): [number, number] {
	// A deletion is marked between the lines around it.
	return hunk.newLines === 0 ? [hunk.newStart, hunk.newStart + 1] : [hunk.newStart, hunk.newStart + hunk.newLines - 1]
}

/** The path in a `---` or `+++` line, or undefined for `/dev/null`, a file that's added or deleted. */
function headerPath(line: string): string | undefined {
	const path = line.slice(4).replace(/\t$/, '')
	return path === '/dev/null' ? undefined : path.slice(2)
}

/** A hunk from its header line, with the array its lines are read into. */
function parseHeader(line: string, lines: readonly string[]): Hunk {
	const [_, oldStart, oldLines, newStart, newLines] = HUNK_HEADER.exec(line) ?? []

	return {
		oldStart: Number(oldStart),
		oldLines: oldLines === undefined ? 1 : Number(oldLines),
		newStart: Number(newStart),
		newLines: newLines === undefined ? 1 : Number(newLines),
		lines,
	}
}

/** The saved change a hunk is, by where it is on HEAD's side, or after HEAD has moved, by its text. */
function findSaved(hunk: Hunk, saved: FileHunks, head: string): SavedHunk | undefined {
	return saved.head === head
		? saved.hunks.find(s => touches(s, hunk))
		: saved.hunks.find(s => s.text === hunkText(hunk))
}

/** Whether two changes overlap or are right next to each other on HEAD's side. */
function touches(a: Pick<Hunk, 'oldStart' | 'oldLines'>, b: Pick<Hunk, 'oldStart' | 'oldLines'>): boolean {
	const [aStart, aEnd] = oldSpan(a)
	const [bStart, bEnd] = oldSpan(b)

	return aStart <= bEnd && bStart <= aEnd
}

/** A change's place on HEAD's side, between lines: lines 3 and 4 are 2 to 4, and an insertion after line 3 is 3 to 3. */
function oldSpan({ oldStart, oldLines }: Pick<Hunk, 'oldStart' | 'oldLines'>): [number, number] {
	return oldLines === 0 ? [oldStart, oldStart] : [oldStart - 1, oldStart - 1 + oldLines]
}

/** A hunk's lines as one string, which finds it again after HEAD has moved. */
function hunkText(hunk: Hunk): string {
	return hunk.lines.join('\n')
}

/** The hunks from the top of the file down. */
function byOldStart(hunks: readonly Hunk[]): Hunk[] {
	return [...hunks].sort((a, b) => a.oldStart - b.oldStart)
}

/** The start of a patch for one file. */
function patchHeader(path: string): string {
	return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`
}

/** A hunk as a patch has it: its header and its lines. */
function formatHunk(hunk: Hunk): string {
	const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`
	return header + hunk.lines.map(line => `${line}\n`).join('')
}

/** A hunk's added lines, each with its line break unless Git says the file ends without one. */
function addedLines(hunk: Hunk): string[] {
	return hunk.lines.flatMap((line, i) =>
		line.startsWith('+') ? [line.slice(1) + (hunk.lines[i + 1]?.startsWith('\\') ? '' : '\n')] : [],
	)
}
