import * as path from 'path'
import * as vscode from 'vscode'
import {
	fileIconId,
	folderIconId,
	normalizeDocument,
	own,
	unescapeCharacter,
	userLanguageAssociations,
} from './iconMatching'
import type {
	IconLookup,
	IconThemeContribution,
	IconThemeDocument,
	IconThemeFont,
	LanguageAssociations,
	LanguageContribution,
	LoadedIconTheme,
} from './types/iconTheme'
import type { IconResolver } from './types/view'
import type { FileIcon, IconFont } from './types/webview'

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
				document: normalizeDocument(document),
			}
		}
	}

	return undefined
}

/** The user's `files.associations` first, then the languages extensions contribute. */
function loadLanguageAssociations(): LanguageAssociations[] {
	const patterns = vscode.workspace.getConfiguration('files').get<Record<string, string>>('associations', {})
	const contributed: LanguageAssociations = { fileNames: new Map(), extensions: new Map() }

	for (const extension of vscode.extensions.all) {
		const languages: readonly LanguageContribution[] = extension.packageJSON?.contributes?.languages ?? []

		for (const language of languages) {
			language.filenames?.forEach(name => contributed.fileNames.set(name.toLowerCase(), language.id))
			language.extensions?.forEach(extension => contributed.extensions.set(extension.toLowerCase(), language.id))
		}
	}

	return [userLanguageAssociations(patterns), contributed]
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
			file: uri => this.toFileIcon(webview, fileIconId(this.lookup(), this.languages, path.basename(uri.fsPath))),
			folder: (uri, expanded) =>
				this.toFileIcon(webview, folderIconId(this.lookup(), path.basename(uri.fsPath), expanded)),
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

	/** What icons are looked up in for the current color theme: its light or high contrast associations first. */
	private lookup(): IconLookup {
		const document = this.theme?.document

		if (!document) {
			return { associations: [], definitions: undefined }
		}

		const kind = vscode.window.activeColorTheme.kind
		const variant =
			kind === vscode.ColorThemeKind.Light
				? document.light
				: kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight
					? document.highContrast
					: undefined

		return { associations: variant ? [variant, document] : [document], definitions: document.iconDefinitions }
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
