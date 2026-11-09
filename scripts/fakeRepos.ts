// Makes .fake-repos/: Git repositories in every state the Changelist view shows, which the "Run
// Extension (fake repositories)" launch configuration opens. `npm run fake-repos` deletes them and
// starts over. With `--if-missing`, which the launch configuration uses, it leaves them alone when
// they're there. repos/ has the repositories, and remotes/ the bare remotes they push to and pull
// from.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Everything the script makes. It's in .gitignore, and .vscode/settings.json keeps this window's Git
// from finding the repositories in it.
const root = '.fake-repos'
// The repositories, the folder the test window opens.
const repos = join(root, 'repos')
// Their remotes, which pushing and pulling go to.
const remotes = join(root, 'remotes')
// The same author for every commit, whatever your Git config says.
const env = {
	...process.env,
	GIT_AUTHOR_NAME: 'Fake',
	GIT_AUTHOR_EMAIL: 'fake@example.com',
	GIT_COMMITTER_NAME: 'Fake',
	GIT_COMMITTER_EMAIL: 'fake@example.com',
}
// How many remotes have been made, which picks each one's delay.
let remoteCount = 0

/**
 * Runs git without signing commits, with `main` as the first branch. Throws with Git's error if it fails.
 */
function git(...args: string[]): void {
	execFileSync('git', ['-c', 'commit.gpsign=false', '-c', 'init.defaultBranch=main', ...args], {
		env,
		stdio: 'pipe',
	})
}
/**
 * Adds a line to a file in a repository, and commits it.
 */
function commit(repo: string, file: string, message: string): void {
	appendFileSync(join(repo, file), `${message}\n`)
	git('-C', repo, 'add', file)
	git('-C', repo, 'commit', '-q', '-m', message)
}

/**
 * Makes a repository with a remote, with one commit pushed, and returns its folder.
 * Its remote answers slowly, like one over the network. Like a clone, it knows the
 * remote's default branch as `origin/HEAD`.
 */
function published(name: string): string {
	const remote = join(remotes, `${name}.git`)
	const repo = join(repos, name)
	git('init', '-q', '--bare', remote)
	git('clone', '-q', remote, repo)
	commit(repo, 'README.md', `# ${name}`)
	git('-C', repo, 'push', '-q', '-u', 'origin', 'main')
	git('-C', repo, 'remote', 'set-head', 'origin', '--auto')
	// Like a remote over the network, it takes a while to answer, 1 to 3 seconds, so the spinners of
	// Fetch All and Pull All can be seen, and the rows finish one by one.
	const delay = 1 + (remoteCount++ % 3)
	git('-C', repo, 'config', 'remote.origin.uploadpack', `sleep ${delay}; git-upload-pack`)
	git('-C', repo, 'config', 'remote.origin.receivepack', `sleep ${delay}; git-receive-pack`)
	return repo
}

/**
 * Pushes commits to a repository's remote from another clone, then fetches them, so the repository
 * is behind.
 */
function pushedElsewhere(name: string, count: number): void {
	const other = join(remotes, `${name}-other`)
	git('clone', '-q', join(remotes, `${name}.git`), other)

	for (let i = 1; i <= count; i++) {
		commit(other, 'CHANGELOG.md', `Someone else's change ${i}`)
	}

	git('-C', other, 'push', '-q')
	rmSync(other, { recursive: true, force: true })
	git('-C', join(repos, name), 'fetch', '-q')
}

// A debug session runs the launch configuration's task again when the test window reloads, while
// the window has the repositories open.
if (process.argv.includes('--if-missing') && existsSync(repos)) {
	console.log(`The fake repositories are already in ${resolve(repos)}`)
	process.exit(0)
}

// VS Code keeps a window's saved state, like its changelists, for the folder it opened as it was
// created. A new repos/ folder would be a new workspace to it, so only what's inside is deleted.
mkdirSync(repos, { recursive: true })
for (const entry of readdirSync(repos)) {
	rmSync(join(repos, entry), { recursive: true, force: true })
}
rmSync(remotes, { recursive: true, force: true })
mkdirSync(remotes)

// synced: clean and up to date, so only the Repositories panel shows it. It's on a release branch,
// so Checkout Default switches it to main.
const docs = published('docs')
git('-C', docs, 'switch', '-q', '-c', 'release')
git('-C', docs, 'push', '-q', '-u', 'origin', 'release')

// ahead: 2 commits to push, and changes, so the changes show it too.
const api = published('api')
commit(api, 'src.ts', 'Add endpoint')
commit(api, 'src.ts', 'Fix endpoint')
appendFileSync(join(api, 'src.ts'), 'work in progress\n')
writeFileSync(join(api, 'notes.md'), 'new\n')

// A worktree of api on its own branch, with a change. Its name sorts between docs and infra, so it
// shows whether it's sorted right below api instead.
const featureX = resolve(repos, 'feature-x')
git('-C', api, 'worktree', 'add', '-q', '-b', 'feature/x', featureX)
appendFileSync(join(featureX, 'README.md'), 'experiment\n')

// behind: 3 commits to pull, and clean.
published('web')
pushedElsewhere('web', 3)

// diverged: 1 commit to push and 2 to pull.
const mobile = published('mobile')
pushedElsewhere('mobile', 2)
commit(mobile, 'app.ts', 'Local change')

// unpublished: a branch without an upstream, with a staged change.
const tools = published('tools')
git('-C', tools, 'switch', '-q', '-c', 'feature/cli')
commit(tools, 'cli.ts', 'Start CLI')
appendFileSync(join(tools, 'cli.ts'), 'more\n')
git('-C', tools, 'add', 'cli.ts')

// detached: HEAD on a commit instead of a branch.
const infra = published('infra')
commit(infra, 'main.tf', 'Second commit')
git('-C', infra, 'push', '-q')
git('-C', infra, 'switch', '-q', '--detach', 'HEAD~1')

// No remote at all, with an untracked file.
const scratch = join(repos, 'scratch')
git('init', '-q', scratch)
commit(scratch, 'idea.md', 'First idea')
writeFileSync(join(scratch, 'todo.md'), 'untracked\n')

console.log(`Made the fake repositories in ${resolve(repos)}`)
