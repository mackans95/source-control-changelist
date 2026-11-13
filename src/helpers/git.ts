// Runs git itself, for what the Git extension's API doesn't have. Only the extension uses it.
import { execFile } from 'child_process'

// Room for the diff of a large file. execFile's default is 1 MB.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Runs git in a folder, with `input` on its stdin, and returns its output. */
export function runGit(gitPath: string, cwd: string, args: readonly string[], input = ''): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(gitPath, args, { cwd, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
			if (error) {
				// gitErrorMessage() reads the line that says what went wrong from `stderr`.
				reject(Object.assign(error, { stderr }))
			} else {
				resolve(stdout)
			}
		})
		// Git can close its stdin before reading it, like `git diff`, which never does. Its exit code says
		// whether it worked, so a closed stdin isn't an error of its own.
		child.stdin?.on('error', () => {})
		child.stdin?.end(input)
	})
}
