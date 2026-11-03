import * as path from 'path'
import * as vscode from 'vscode'
import type {
	IconAssociations,
	IconThemeContribution,
	IconThemeDocument,
	IconThemeFont,
	LanguageAssociations,
	LanguageContribution,
	LoadedIconTheme,
} from './types/iconTheme'
import type { IconResolver } from './types/view'
import type { FileIcon, IconFont } from './types/webview'

/** Looks up a key the theme has itself, so a file named `constructor` doesn't find Object's. */
function own<T>(record: Readonly<Record<string, T>> | undefined, key: string | undefined): T | undefined {
	return record && key !== undefined && Object.hasOwn(record, key) ? record[key] : undefined
}

function lowercaseKeys(record: Readonly<Record<string, string>> | undefined): Record<string, string> | undefined {
	return record && Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]))
}

// VS Code matches names without case, so the theme's names are made lowercase once, when it loads.
function normalize(associations: IconAssociations | undefined): IconAssociations | undefined {
	return (
		associations && {
			...associations,
			fileNames: lowercaseKeys(associations.fileNames),
			fileExtensions: lowercaseKeys(associations.fileExtensions),
			folderNames: lowercaseKeys(associations.folderNames),
			folderNamesExpanded: lowercaseKeys(associations.folderNamesExpanded),
		}
	)
}

/** The extensions of a file name, longest first: `d.ts` and then `ts` for `index.d.ts`. */
function extensionsOf(name: string): string[] {
	const segments = name.split('.').slice(1)
	return segments.map((_, i) => segments.slice(i).join('.'))
}

/** Theme fonts give their characters as CSS escapes, like `\E004`. */
function unescapeCharacter(value: string): string {
	return value.replace(/\\([0-9a-f]{1,6}) ?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
}

function fontFamily(theme: LoadedIconTheme, font: IconThemeFont): string {
	return `${theme.id}-${font.id}`
}

async function loadIconTheme(id: string): Promise<LoadedIconTheme | undefined> {
	for (const extension of vscode.extensions.all) {
		const themes: readonly IconThemeContribution[] = extension.packageJSON?.contributes?.iconThemes ?? []
		const theme = themes.find(t => t.id === id)

		if (theme) {
			const uri = vscode.Uri.joinPath(extension.extensionUri, theme.path)
			const document = JSON.parse(
				new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
			) as IconThemeDocument

			return {
				id,
				uri,
				extensionUri: extension.extensionUri,
				document: {
					...document,
					...normalize(document),
					light: normalize(document.light),
					highContrast: normalize(document.highContrast),
				},
			}
		}
	}

	return undefined
}

/** The user's `files.associations` first, then the languages extensions contribute. */
function loadLanguageAssociations(): LanguageAssociations[] {
	const user: LanguageAssociations = { fileNames: new Map(), extensions: new Map() }
	// Only the simple patterns: `*.ext` and plain file names.
	const patterns = vscode.workspace.getConfiguration('files').get<Record<string, string>>('associations', {})

	for (const [pattern, language] of Object.entries(patterns)) {
		if (/^\*\.[^*?/{[]+$/.test(pattern)) {
			user.extensions.set(pattern.slice(1).toLowerCase(), language)
		} else if (!/[*?/{[]/.test(pattern)) {
			user.fileNames.set(pattern.toLowerCase(), language)
		}
	}

	const contributed: LanguageAssociations = { fileNames: new Map(), extensions: new Map() }

	for (const extension of vscode.extensions.all) {
		const languages: readonly LanguageContribution[] = extension.packageJSON?.contributes?.languages ?? []

		for (const language of languages) {
			language.filenames?.forEach(name => contributed.fileNames.set(name.toLowerCase(), language.id))
			language.extensions?.forEach(extension => contributed.extensions.set(extension.toLowerCase(), language.id))
		}
	}

	return [user, contributed]
}

/**
 * The file icon theme's icons, for the Changelist view's webview. VS Code has no API for them, so
 * this reads the theme's JSON file and matches files like VS Code does: by name, then by the
 * longest extension, then by language, and otherwise the theme's default file icon.
 */
export class FileIcons implements vscode.Disposable {
	private theme: LoadedIconTheme | undefined
	private languages: LanguageAssociations[] = []
	private readonly changeEmitter = new vscode.EventEmitter<void>()
	readonly onDidChange = this.changeEmitter.event
	private readonly disposables: vscode.Disposable[]

	constructor() {
		this.disposables = [
			this.changeEmitter,
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('workbench.iconTheme') || e.affectsConfiguration('files.associations')) {
					void this.load()
				}
			}),
			// Installed extensions can bring the theme, or languages.
			vscode.extensions.onDidChange(() => void this.load()),
			// Themes can have other icons for light and high contrast color themes.
			vscode.window.onDidChangeActiveColorTheme(() => this.changeEmitter.fire()),
		]
		void this.load()
	}

	/** The folder the webview loads the theme's icons and fonts from. */
	get resourceRoot(): vscode.Uri | undefined {
		return this.theme?.extensionUri
	}

	resolver(webview: vscode.Webview): IconResolver {
		return {
			fonts: () => this.fonts(webview),
			file: uri => this.toFileIcon(webview, this.fileIconId(uri)),
			folder: (uri, expanded) => this.toFileIcon(webview, this.folderIconId(uri, expanded)),
		}
	}

	private async load(): Promise<void> {
		const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme')
		this.languages = loadLanguageAssociations()

		try {
			this.theme = id ? await loadIconTheme(id) : undefined
		} catch {
			// A theme that can't be read shows no icons, like when no theme is set.
			this.theme = undefined
		}
		this.changeEmitter.fire()
	}

	/** The theme's associations for the current color theme, the light or high contrast ones first. */
	private associations(): IconAssociations[] {
		const document = this.theme?.document

		if (!document) {
			return []
		}

		const kind = vscode.window.activeColorTheme.kind
		const variant =
			kind === vscode.ColorThemeKind.Light
				? document.light
				: kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight
					? document.highContrast
					: undefined

		return variant ? [variant, document] : [document]
	}

	/**
	 * The first icon the associations give, the light or high contrast ones first. Like VS Code, it
	 * skips icons the theme leaves empty, like vscode-icons' light file icon.
	 */
	private pick(
		associations: readonly IconAssociations[],
		get: (associations: IconAssociations) => string | undefined,
	): string | undefined {
		return associations.map(get).find(id => {
			const definition = own(this.theme?.document.iconDefinitions, id)
			return definition?.iconPath || definition?.fontCharacter
		})
	}

	private languageOf(name: string, extensions: readonly string[]): string | undefined {
		for (const languages of this.languages) {
			const language =
				languages.fileNames.get(name) ??
				extensions.map(ext => languages.extensions.get(`.${ext}`)).find(Boolean)

			if (language) {
				return language
			}
		}

		return undefined
	}

	private fileIconId(uri: vscode.Uri): string | undefined {
		const associations = this.associations()
		const name = path.basename(uri.fsPath).toLowerCase()
		const extensions = extensionsOf(name)
		const language = this.languageOf(name, extensions)

		return (
			this.pick(associations, a => own(a.fileNames, name)) ??
			extensions.map(ext => this.pick(associations, a => own(a.fileExtensions, ext))).find(Boolean) ??
			this.pick(associations, a => own(a.languageIds, language)) ??
			this.pick(associations, a => a.file)
		)
	}

	private folderIconId(uri: vscode.Uri, expanded: boolean): string | undefined {
		const associations = this.associations()
		const name = path.basename(uri.fsPath).toLowerCase()

		if (expanded) {
			return (
				this.pick(associations, a => own(a.folderNamesExpanded, name)) ??
				this.pick(associations, a => own(a.folderNames, name)) ??
				this.pick(associations, a => a.folderExpanded) ??
				this.pick(associations, a => a.folder)
			)
		}

		return this.pick(associations, a => own(a.folderNames, name)) ?? this.pick(associations, a => a.folder)
	}

	/** Paths in the theme are relative to its JSON file. */
	private resolve(theme: LoadedIconTheme, relativePath: string): vscode.Uri {
		return vscode.Uri.joinPath(theme.uri, '..', relativePath)
	}

	private toFileIcon(webview: vscode.Webview, id: string | undefined): FileIcon | undefined {
		const theme = this.theme
		const definition = own(theme?.document.iconDefinitions, id)

		if (!theme || !definition) {
			return undefined
		}

		if (definition.iconPath) {
			return {
				type: 'image',
				uri: webview.asWebviewUri(this.resolve(theme, definition.iconPath)).toString(),
				mask: theme.document.usesCurrentColor ?? false,
			}
		}

		const fonts = theme.document.fonts ?? []
		const font = fonts.find(f => f.id === definition.fontId) ?? fonts[0]

		if (!definition.fontCharacter || !font) {
			return undefined
		}

		return {
			type: 'font',
			character: unescapeCharacter(definition.fontCharacter),
			family: fontFamily(theme, font),
			color: definition.fontColor,
			size: definition.fontSize ?? font.size,
			weight: font.weight,
			style: font.style,
		}
	}

	private fonts(webview: vscode.Webview): IconFont[] {
		const theme = this.theme

		if (!theme) {
			return []
		}

		return (theme.document.fonts ?? []).map(font => ({
			family: fontFamily(theme, font),
			src: font.src
				.map(src => `url("${webview.asWebviewUri(this.resolve(theme, src.path))}") format("${src.format}")`)
				.join(', '),
			weight: font.weight,
			style: font.style,
		}))
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose())
	}
}
