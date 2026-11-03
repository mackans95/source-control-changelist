// Releases a new version from main: bumps the version and the changelog, commits, tags and pushes, then publishes the
// draft release the Release workflow creates, which starts the Publish workflow (VS Code Marketplace and Open VSX).
// `npm run release -- <patch|minor|major|x.y.z>` starts a release. Every step skips itself once it's done, so after a
// failure, fix the problem and run `npm run release` again, without an argument, to carry on.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { setTimeout } from 'node:timers/promises'

const repo = 'mackans95/source-control-changelist'
// The files the version bump changes, and the only ones the release commit includes.
const releaseFiles = ['package.json', 'package-lock.json', 'CHANGELOG.md']

/**
 * Prints the name of the step that's about to run.
 */
function step(title: string): void {
	console.log(`\n▸ ${title}`)
}

/**
 * Prints why the release stopped, and exits.
 */
function fail(message: string): never {
	console.error(`\n${message}`)
	process.exit(1)
}

/**
 * Runs a command and returns whether it succeeded. Its output is shown in the terminal unless `quiet` is set.
 */
function tryRun(cmd: string, args: string[], quiet = false): boolean {
	try {
		execFileSync(cmd, args, { stdio: quiet ? 'ignore' : 'inherit' })
		return true
	} catch {
		return false
	}
}

/**
 * Runs a command with its output shown in the terminal, and stops the release if it fails.
 */
function run(cmd: 'git' | 'npm' | 'gh', args: string[]): void {
	if (!tryRun(cmd, args)) fail(`Failed: ${cmd} ${args.join(' ')}`)
}

/**
 * Runs a command and returns its output, trimmed. Throws if it fails.
 */
function read(cmd: 'git' | 'gh', args: string[]): string {
	return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
}

/**
 * Asks a yes/no question in the terminal. Anything but `y` counts as no.
 */
async function confirm(question: string): Promise<boolean> {
	const prompt = createInterface({ input: process.stdin, output: process.stdout })
	const answer = await prompt.question(`\n${question} [y/N] `)
	prompt.close()
	return answer.trim().toLowerCase() === 'y'
}

/**
 * The version in package.json.
 */
function readVersion(): string {
	return JSON.parse(readFileSync('package.json', 'utf8')).version
}

/**
 * Whether the tag exists in this clone, or on GitHub when `remote` is set.
 */
function hasTag(tag: string, remote = false): boolean {
	const args = remote ? ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`] : ['tag', '--list', tag]
	return read('git', args) !== ''
}

/**
 * The GitHub release for the tag, or undefined if there isn't one.
 */
function findRelease(tag: string): { isDraft: boolean; assets: { name: string }[] } | undefined {
	try {
		const json = execFileSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,assets'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		return JSON.parse(json)
	} catch {
		return undefined
	}
}

/**
 * The notes under `## <heading>` in the changelog, up to the next `## ` heading, or '' if there's no such heading.
 */
function changelogSection(changelog: string, heading: string): string {
	const lines = changelog.split('\n')
	const start = lines.indexOf(`## ${heading}`)

	if (start === -1) {
		return ''
	}

	const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))

	return lines
		.slice(start + 1, end === -1 ? undefined : end)
		.join('\n')
		.trim()
}

/**
 * The release notes: a line saying what kind of release it is, the version's changelog notes and how to install it.
 */
function releaseNotes(version: string, notes: string): string {
	const kind = version.endsWith('.0') ? 'Feature release.' : 'Bug fix release.'
	const vsix = `source-control-changelist-${version}.vsix`

	return [
		kind,
		'',
		notes,
		'',
		'### Install',
		'',
		'- From the VS Code Marketplace: search for **Changelist** in the Extensions view, or visit [the Marketplace page](https://marketplace.visualstudio.com/items?itemName=mackans95.source-control-changelist).',
		'- In VSCodium, Cursor, Windsurf and other editors that use Open VSX: search for **Changelist** in the Extensions view, or visit [the Open VSX page](https://open-vsx.org/extension/mackans95/source-control-changelist).',
		`- Or download \`${vsix}\` below and run \`code --install-extension ${vsix}\`.`,
		'',
	].join('\n')
}

/**
 * Waits for the newest run of a workflow for the tag to show up on GitHub, and returns its ID.
 */
async function findRun(workflow: string, tag: string): Promise<string> {
	const args = ['run', 'list', '--repo', repo, '--workflow', workflow, '--branch', tag, '--limit', '1']
	// A run can take a few seconds to show up after the push or the publish that starts it.
	for (let attempt = 0; attempt < 10; attempt++) {
		const id = read('gh', [...args, '--json', 'databaseId', '--jq', '.[0].databaseId // empty'])
		if (id) {
			return id
		}
		await setTimeout(3000)
	}
	fail(`No ${workflow} run for ${tag} showed up. Check https://github.com/${repo}/actions`)
}

/**
 * Follows a workflow run in the terminal until it finishes, and returns whether it succeeded.
 */
function watchRun(id: string): boolean {
	return tryRun('gh', ['run', 'watch', id, '--repo', repo, '--exit-status', '--compact'])
}

// gh otherwise uses the active account, which may be the one that can't write to this repository.
process.env.GH_TOKEN = read('gh', ['auth', 'token', '--user', 'mackans95'])

const bump = process.argv[2]
let version = readVersion()

step('Checking main')
if (read('git', ['branch', '--show-current']) !== 'main') {
	fail('Switch to main first.')
}
run('git', ['fetch', '--quiet', 'origin'])
if (read('git', ['rev-list', '--count', 'HEAD..origin/main']) !== '0') {
	fail('main is behind origin/main. Pull first.')
}

// The version in package.json is either released (its GitHub release is published) or in the middle of a release.
const released = findRelease(`v${version}`)?.isDraft === false
if (bump && !released) {
	fail(`The release of ${version} isn't finished. Run npm run release without an argument to carry on.`)
}
if (!bump && released) {
	console.log(`${version} is already released, so this only checks its Publish run.`)
	console.log('To start a new release, pass patch, minor, major or a version: npm run release -- minor')
}

if (bump) {
	step('Bumping the version')
	if (read('git', ['status', '--porcelain']) !== '') {
		fail('Commit or stash your changes first.')
	}
	const changelog = readFileSync('CHANGELOG.md', 'utf8')
	if (!changelogSection(changelog, 'Unreleased')) {
		fail('Write the notes under "## Unreleased" in CHANGELOG.md first.')
	}
	run('npm', ['version', bump, '--no-git-tag-version'])
	version = readVersion()
	writeFileSync('CHANGELOG.md', changelog.replace(/^## Unreleased$/m, `## ${version}`))
}

const tag = `v${version}`

if (read('git', ['status', '--porcelain', '--', ...releaseFiles]) !== '') {
	step(`Checking and committing ${version}`)
	const changelog = readFileSync('CHANGELOG.md', 'utf8')
	if (!changelogSection(changelog, version)) {
		fail(`CHANGELOG.md has no notes under "## ${version}".`)
	}
	for (const script of ['lint', 'format:check', 'typecheck', 'test']) {
		run('npm', ['run', script])
	}
	run('git', ['commit', '--quiet', '-m', `Release ${version}`, '--', ...releaseFiles])
}

if (!hasTag(tag)) {
	step(`Tagging ${tag}`)
	run('git', ['tag', '-a', tag, '-m', `Changelist ${version}`])
}

if (!hasTag(tag, true)) {
	step('Pushing')
	run('git', ['--no-pager', 'show', '--stat', 'HEAD'])
	if (!(await confirm(`Push main and ${tag}? That starts the Release workflow.`))) {
		fail(
			`Stopped before pushing. Run npm run release to carry on, or undo with: git tag -d ${tag} && git reset --hard origin/main`,
		)
	}
	run('git', ['push', '--atomic', 'origin', 'main', tag])
}

if (!findRelease(tag)?.assets.some(asset => asset.name.endsWith('.vsix'))) {
	step('Waiting for the Release workflow to attach the .vsix')
	const id = await findRun('release.yml', tag)
	if (!watchRun(id)) {
		fail(
			`The Release workflow failed. See why with: gh run view ${id} --repo ${repo} --log-failed. Re-run it on the Actions tab, then run npm run release again.`,
		)
	}
}

if (findRelease(tag)?.isDraft) {
	step('Publishing the GitHub release')
	const notes = releaseNotes(version, changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version))
	const file = join(mkdtempSync(join(tmpdir(), 'release-')), 'notes.md')
	writeFileSync(file, notes)
	console.log(`\n${notes}\nThe notes are in ${file}. Edit that file first if you want to change them.`)
	if (!(await confirm('Publish the release? That also publishes the extension to the Marketplace and Open VSX.'))) {
		fail('Stopped before publishing. Run npm run release again to carry on.')
	}
	run('gh', ['release', 'edit', tag, '--repo', repo, '--notes-file', file, '--draft=false'])
}

step('Waiting for the Publish workflow')
const publishRun = await findRun('publish.yml', tag)
while (!watchRun(publishRun)) {
	const jq = '.jobs[].steps[] | select(.conclusion == "failure") | .name'
	const failed = read('gh', ['run', 'view', publishRun, '--repo', repo, '--json', 'jobs', '--jq', jq])
	console.log(
		`\nFailed: ${failed.replaceAll('\n', ', ')}. See why with: gh run view ${publishRun} --repo ${repo} --log-failed`,
	)
	if (!(await confirm('Re-run it? A registry that already has this version is skipped.'))) {
		fail(`Publish by hand instead: download the .vsix from https://github.com/${repo}/releases/tag/${tag}
and upload it on https://marketplace.visualstudio.com/manage, or with npx ovsx publish <file> -p <token>.`)
	}
	run('gh', ['run', 'rerun', publishRun, '--repo', repo, '--failed'])
	// Gives GitHub a moment to queue the new attempt, so the watch doesn't report the old one.
	await setTimeout(5000)
}
console.log(`\nReleased ${version}. The Marketplace takes a few minutes to verify it before it shows up there.`)
