import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { runGit } from '#helpers/git.ts'
import { assignHunks, discardPatch, hunksInLines, parseDiff, splitHunks, stagePatch, withHunks } from '#model/hunks.ts'
import type { FileHunks, Hunk } from '#types/extension.ts'

// Lines 1 to 30, one number each, like `seq 1 30`.
const NUMBERS = Array.from({ length: 30 }, (_, i) => `${i + 1}\n`).join('')

// The repositories the tests made, deleted when they're done.
const repositories: string[] = []
after(() => repositories.forEach(dir => rmSync(dir, { recursive: true, force: true })))

/** A hunk with these lines, at these places. */
function hunk(oldStart: number, oldLines: number, newStart: number, newLines: number, lines: string[] = []): Hunk {
	return { oldStart, oldLines, newStart, newLines, lines }
}

/** A repository with `f.txt` committed as `head`, and then changed to `working`. */
async function repository(head: string, working: string): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), 'changelist-hunks-'))
	const git = (...args: string[]) => runGit('git', dir, args)
	await git('init', '-q')
	writeFileSync(join(dir, 'f.txt'), head)
	await git('add', 'f.txt')
	await commit(dir, 'head')
	writeFileSync(join(dir, 'f.txt'), working)
	repositories.push(dir)
	return dir
}

/** Commits what's staged, whatever your Git config says. */
function commit(dir: string, message: string): Promise<string> {
	const config = ['user.name=Test', 'user.email=test@example.com', 'commit.gpgsign=false', 'core.hooksPath=/dev/null']
	return runGit('git', dir, [...config.flatMap(c => ['-c', c]), 'commit', '-qm', message])
}

/** The hunks of f.txt against HEAD. */
async function diff(dir: string, cached = false): Promise<Hunk[]> {
	const output = await runGit('git', dir, ['diff', '-U0', ...(cached ? ['--cached'] : ['HEAD']), '--', 'f.txt'])
	return parseDiff(output).get('f.txt') ?? []
}

/** NUMBERS with these lines replaced, by line number, and lines added at the end. */
function changed(replace: Record<number, string>, append = ''): string {
	return NUMBERS.split('\n')
		.slice(0, 30)
		.map((line, i) => replace[i + 1] ?? line)
		.join('\n')
		.concat('\n', append)
}

describe('parseDiff', () => {
	test('reads each hunk, with a left-out count as 1', () => {
		const output = [
			'diff --git a/f.txt b/f.txt',
			'index e8823e1..1ac4278 100644',
			'--- a/f.txt',
			'+++ b/f.txt',
			'@@ -3,2 +3,2 @@',
			'-3',
			'-4',
			'+three',
			'+four',
			'@@ -20 +20 @@ 19',
			'-20',
			'+twenty',
			'@@ -30,0 +31 @@',
			'+new',
			'',
		].join('\n')
		assert.deepEqual(parseDiff(output).get('f.txt'), [
			hunk(3, 2, 3, 2, ['-3', '-4', '+three', '+four']),
			hunk(20, 1, 20, 1, ['-20', '+twenty']),
			hunk(30, 0, 31, 1, ['+new']),
		])
	})
	test('reads several files, an added line that starts with ++, and a missing newline', () => {
		const output = [
			'diff --git a/a.txt b/a.txt',
			'--- a/a.txt',
			'+++ b/a.txt',
			'@@ -1 +1 @@',
			'-a',
			'+++ a',
			'diff --git a/gone.txt b/gone.txt',
			'deleted file mode 100644',
			'--- a/gone.txt',
			'+++ /dev/null',
			'@@ -1 +0,0 @@',
			'-gone',
			'\\ No newline at end of file',
			'',
		].join('\n')
		const files = parseDiff(output)
		assert.deepEqual([...files.keys()], ['a.txt', 'gone.txt'])
		assert.deepEqual(files.get('a.txt'), [hunk(1, 1, 1, 1, ['-a', '+++ a'])])
		assert.deepEqual(files.get('gone.txt'), [hunk(1, 1, 0, 0, ['-gone', '\\ No newline at end of file'])])
	})
	test('reads what git diff -U0 prints', async () => {
		const dir = await repository(NUMBERS, changed({ 3: 'three', 4: 'four', 20: 'twenty' }, 'new\n'))
		assert.deepEqual(
			(await diff(dir)).map(h => [h.oldStart, h.oldLines, h.newStart, h.newLines]),
			[
				[3, 2, 3, 2],
				[20, 1, 20, 1],
				[30, 0, 31, 1],
			],
		)
	})
})

describe('assignHunks and splitHunks', () => {
	const first = hunk(3, 2, 3, 2, ['-3', '-4', '+three', '+four'])
	const second = hunk(20, 1, 20, 1, ['-20', '+twenty'])
	const saved: FileHunks = { head: 'abc', hunks: [{ oldStart: 20, oldLines: 1, text: '-20\n+twenty', list: 'B' }] }

	test('keeps a saved change in its list, and the rest in the file', () => {
		assert.deepEqual(assignHunks([first, second], saved, 'abc', [first, second], 'A', undefined), ['A', 'B'])
	})
	test('keeps a saved change in its list when it grows or something is added right next to it', () => {
		const grown = hunk(19, 3, 19, 4, ['-19', '-20', '-21', '+19', '+twenty', '+more', '+21'])
		const below = hunk(20, 0, 21, 1, ['+below'])
		assert.deepEqual(assignHunks([grown], saved, 'abc', [second], 'A', undefined), ['B'])
		assert.deepEqual(assignHunks([below], saved, 'abc', [second], 'A', undefined), ['B'])
	})
	test('puts a new change in the active list, and leaves the ones it had alone', () => {
		const added = hunk(10, 1, 10, 1, ['-10', '+ten'])
		assert.deepEqual(assignHunks([first, added], undefined, 'abc', [first], 'A', 'B'), ['A', 'B'])
	})
	test('puts nothing in the active list on the first check, when every change is already there', () => {
		assert.deepEqual(assignHunks([first, second], undefined, 'abc', undefined, 'A', 'B'), ['A', 'A'])
	})
	test('finds a saved change by its text after HEAD has moved', () => {
		const moved = hunk(18, 1, 18, 1, ['-20', '+twenty'])
		assert.deepEqual(assignHunks([moved], saved, 'def', [moved], 'A', undefined), ['B'])
		assert.deepEqual(assignHunks([first], saved, 'def', [first], 'A', undefined), ['A'])
	})
	test('saves only the changes in another list than the file', () => {
		assert.deepEqual(splitHunks([first, second], ['A', 'B'], 'A', 'abc'), saved)
		assert.deepEqual(splitHunks([first, second], ['A', undefined], 'A', 'abc')?.hunks[0].list, undefined)
		assert.equal(splitHunks([first, second], ['A', 'A'], 'A', 'abc'), undefined)
	})
})

describe('stagePatch, discardPatch and withHunks', () => {
	const working = changed({ 3: 'three', 4: 'four', 20: 'twenty' }, 'new\n')

	test('stages only the chosen change, and a commit takes nothing else', async () => {
		const dir = await repository(NUMBERS, working)
		const [, middle] = await diff(dir)
		await runGit('git', dir, ['apply', '--cached', '--unidiff-zero', '-'], stagePatch('f.txt', [middle]))
		assert.deepEqual(
			(await diff(dir, true)).map(h => h.lines),
			[['-20', '+twenty']],
		)
		await commit(dir, 'middle')
		assert.deepEqual(
			(await diff(dir)).map(h => h.lines),
			[['-3', '-4', '+three', '+four'], ['+new']],
		)
		assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), working)
	})
	test('stages a change below one that was left out, which moved its lines', async () => {
		const dir = await repository(NUMBERS, changed({ 3: 'three\nmore' }, 'new\n'))
		const [, end] = await diff(dir)
		await runGit('git', dir, ['apply', '--cached', '--unidiff-zero', '-'], stagePatch('f.txt', [end]))
		assert.deepEqual(
			(await diff(dir, true)).map(h => h.lines),
			[['+new']],
		)
	})
	test('discards only the chosen change from the working tree', async () => {
		const dir = await repository(NUMBERS, working)
		const [first] = await diff(dir)
		await runGit('git', dir, ['apply', '-R', '--unidiff-zero', '-'], discardPatch('f.txt', [first]))
		assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), changed({ 20: 'twenty' }, 'new\n'))
	})
	test("builds the file with only some changes, and with all of them it's the working tree's", async () => {
		const dir = await repository(NUMBERS, working)
		const hunks = await diff(dir)
		assert.equal(withHunks(NUMBERS, [hunks[1]]), changed({ 20: 'twenty' }))
		assert.equal(withHunks(NUMBERS, hunks), working)
	})
	test('keeps a file without a newline at its end', async () => {
		const head = 'a\nb'
		const dir = await repository(head, 'a\nB\nc')
		const hunks = await diff(dir)
		assert.equal(withHunks(head, hunks), 'a\nB\nc')
	})
})

describe('hunksInLines', () => {
	const changedLines = hunk(3, 2, 3, 2)
	const deleted = hunk(10, 2, 7, 0)

	test('finds the change on a changed line', () => {
		assert.deepEqual(hunksInLines([changedLines, deleted], 4, 4), [changedLines])
		assert.deepEqual(hunksInLines([changedLines, deleted], 5, 5), [])
	})
	test('finds a deletion from the lines on either side of it', () => {
		assert.deepEqual(hunksInLines([changedLines, deleted], 7, 7), [deleted])
		assert.deepEqual(hunksInLines([changedLines, deleted], 8, 8), [deleted])
		assert.deepEqual(hunksInLines([changedLines, deleted], 9, 9), [])
	})
	test('finds every change in a selection', () => {
		assert.deepEqual(hunksInLines([changedLines, deleted], 1, 7), [changedLines, deleted])
	})
})
