// Builds src/ into dist/ with esbuild. `node scripts/build.ts --watch` rebuilds on every change.
// Type checking is separate (npm run typecheck): esbuild only strips the types.
import * as esbuild from 'esbuild'

// While debugging: rebuild on every change, instead of building once.
const watch = process.argv.includes('--watch')

// The extension, which VS Code loads from dist/extension.js (package.json's main).
const extension: esbuild.BuildOptions = {
	entryPoints: ['src/extension.ts'],
	outfile: 'dist/extension.js',
	bundle: true,
	format: 'cjs',
	// VS Code 1.82 (package.json engines) runs extensions on Node 18.
	platform: 'node',
	target: 'node18',
	external: ['vscode'],
	// Readable in the published package; source maps only while developing.
	sourcemap: watch,
	// While watching, watchLog below reports problems in the one-line format tasks.json reads.
	logLevel: watch ? 'silent' : 'warning',
}

// The Changelist view's page. It loads the script as a plain <script>, so it's one self-contained file.
const webview: esbuild.BuildOptions = {
	entryPoints: { webview: 'src/webview/index.ts' },
	outdir: 'dist',
	bundle: true,
	format: 'iife',
	platform: 'browser',
	// VS Code 1.82's webviews run Chromium 114 (Electron 25).
	target: 'chrome114',
	sourcemap: watch,
	logLevel: watch ? 'silent' : 'warning',
}

// The page's stylesheet: styles/index.css and the files it imports, bundled into one file, with the
// codicon font copied next to it as dist/codicon.ttf.
const styles: esbuild.BuildOptions = {
	entryPoints: { webview: 'src/webview/styles/index.css' },
	outdir: 'dist',
	bundle: true,
	loader: { '.ttf': 'file' },
	assetNames: '[name]',
	target: 'chrome114',
	sourcemap: watch,
	logLevel: watch ? 'silent' : 'warning',
}

// How many of the builds are running right now.
let running = 0
// tasks.json waits for these lines before starting a debug session. With several builds running
// at once, only the first start and the last finish are logged.
const watchLog: esbuild.Plugin = {
	name: 'watch-log',
	setup(build) {
		build.onStart(() => {
			if (running++ === 0) {
				console.log('[watch] build started')
			}
		})
		build.onEnd(result => {
			for (const { text, location } of [...result.errors, ...result.warnings]) {
				console.error(`✘ ${location?.file}:${location?.line}:${location?.column}: ${text}`)
			}
			if (--running === 0) {
				console.log('[watch] build finished')
			}
		})
	},
}

// Built at the same time.
const builds = [extension, webview, styles]
if (watch) {
	for (const options of builds) {
		const context = await esbuild.context({ ...options, plugins: [watchLog] })
		await context.watch()
	}
} else {
	await Promise.all(builds.map(options => esbuild.build(options)))
}
