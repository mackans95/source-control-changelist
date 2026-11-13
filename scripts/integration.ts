// Runs the integration tests (test/integration/) in a VS Code window: bundles them next to the built
// extension, and starts the VS Code that @vscode/test-electron downloads to .vscode-test/, with its own
// settings, an empty folder for the tests' repositories, and a Git identity of its own. Prints the
// tests' results, and writes all of VS Code's output to out/integration.log.
// `npm run test:integration` builds the extension first.
import { runTests } from '@vscode/test-electron'
import * as esbuild from 'esbuild'
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { Writable } from 'node:stream'

// The extension's folder, which the tests' bundle must be inside to share the extension's `vscode` object.
const extension = resolve(import.meta.dirname, '..')
const bundle = join(extension, 'out', 'integration.js')
const logFile = join(extension, 'out', 'integration.log')
// The lines of VS Code's output that are the tests' results: a passed or failed test, and why it failed.
const RESULT = /^( {2}[✔✖] | {6})/

await esbuild.build({
	entryPoints: [join(extension, 'test', 'integration', 'index.ts')],
	outfile: bundle,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'node20',
	external: ['vscode'],
	logLevel: 'warning',
})

// VS Code's socket path in the user data folder must be under 104 characters on macOS, so everything
// goes in a short temporary folder instead of the project's.
const root = mkdtempSync(join(tmpdir(), 'cl-'))
const userData = join(root, 'data')
const workspace = join(root, 'repos')
const gitConfig = join(root, 'gitconfig')
mkdirSync(workspace)
// Git's settings for the tests' repositories and the Git extension, instead of yours.
writeFileSync(
	gitConfig,
	'[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n',
)

// From a terminal in VS Code, these would make the test window run as Node, or open in that VS Code.
for (const name of Object.keys(process.env)) {
	if (/^(ELECTRON|VSCODE)_/.test(name)) delete process.env[name]
}

const log = createWriteStream(logFile)
const output = resultsOnly(log)
let passed = true

try {
	await runTests({
		extensionDevelopmentPath: extension,
		extensionTestsPath: bundle,
		extensionTestsEnv: { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' },
		launchArgs: [workspace, `--user-data-dir=${userData}`, '--disable-extensions'],
		stdout: output,
		stderr: output,
	})
} catch {
	passed = false
} finally {
	log.end()
	rmSync(root, { recursive: true, force: true })
}

if (!passed) {
	console.error(`\nThe integration tests failed. VS Code's output is in ${relative(process.cwd(), logFile)}.`)
	process.exitCode = 1
}

/** Prints the tests' results from VS Code's output as they come, and writes all of the output to the log. */
function resultsOnly(log: WriteStream): Writable {
	// The end of the output so far, when it isn't a whole line yet.
	let partial = ''

	return new Writable({
		write(chunk: Buffer, _encoding, done) {
			log.write(chunk)
			const lines = (partial + chunk.toString()).split('\n')
			partial = lines.pop() ?? ''

			for (const line of lines) {
				if (RESULT.test(line)) console.log(line)
			}

			done()
		},
	})
}
