// The parts of a file icon theme that the Changelist view uses, as the theme's JSON file and its
// extension's package.json have them. See https://code.visualstudio.com/api/extension-guides/file-icon-theme
import type * as vscode from 'vscode'

/** One of the theme's icons. */
export interface IconDefinition {
	/** An image, relative to the theme's JSON file. */
	readonly iconPath?: string
	/** A character in one of the theme's fonts, as a CSS escape like `\E004`. */
	readonly fontCharacter?: string
	readonly fontColor?: string
	readonly fontSize?: string
	/** One of the theme's fonts. The first one when it's left out. */
	readonly fontId?: string
}

/** A font in the theme's JSON file. */
export interface IconThemeFont {
	readonly id: string
	/** Paths relative to the theme's JSON file. */
	readonly src: readonly { readonly path: string; readonly format: string }[]
	readonly weight?: string
	readonly style?: string
	readonly size?: string
}

/** Which icon definition each kind of file and folder gets. */
export interface IconAssociations {
	readonly file?: string
	readonly folder?: string
	readonly folderExpanded?: string
	readonly folderNames?: Readonly<Record<string, string>>
	readonly folderNamesExpanded?: Readonly<Record<string, string>>
	readonly fileExtensions?: Readonly<Record<string, string>>
	readonly fileNames?: Readonly<Record<string, string>>
	readonly languageIds?: Readonly<Record<string, string>>
}

/** The theme's associations are for dark color themes; `light` and `highContrast` override them. */
export interface IconThemeDocument extends IconAssociations {
	readonly iconDefinitions?: Readonly<Record<string, IconDefinition>>
	readonly fonts?: readonly IconThemeFont[]
	/** Whether the theme's images are drawn in `currentColor`, so they take the text color. */
	readonly usesCurrentColor?: boolean
	readonly light?: IconAssociations
	readonly highContrast?: IconAssociations
}

/** An icon theme in an extension's package.json. */
export interface IconThemeContribution {
	readonly id: string
	readonly path: string
}

/** A language in an extension's package.json. */
export interface LanguageContribution {
	readonly id: string
	readonly extensions?: readonly string[]
	readonly filenames?: readonly string[]
}

/** A theme, read from the extension that has it. */
export interface LoadedIconTheme {
	readonly id: string
	readonly document: IconThemeDocument
	/** The theme's JSON file, which the paths in it are relative to. */
	readonly uri: vscode.Uri
	/** The folder of the extension that has the theme. The webview needs access to it for the icons. */
	readonly extensionUri: vscode.Uri
}

/**
 * What a file's or folder's icon is looked up in: the theme's associations for the current color
 * theme, the light or high contrast ones first, and the icons it defines.
 */
export interface IconLookup {
	readonly associations: readonly IconAssociations[]
	readonly definitions: Readonly<Record<string, IconDefinition>> | undefined
}

/** The languages VS Code would give files from their names. Keys are lowercase; extensions have their dot. */
export interface LanguageAssociations {
	readonly fileNames: Map<string, string>
	readonly extensions: Map<string, string>
}
