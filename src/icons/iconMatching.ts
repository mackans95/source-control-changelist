// How VS Code picks a file's or folder's icon from a file icon theme. It doesn't use `vscode`, so
// the tests can run it in Node.
import type { IconAssociations, IconLookup, IconThemeDocument, LanguageAssociations } from '../types/iconTheme.ts'

/** A file's icon: by name, then by the longest extension, then by language, and otherwise the theme's default. */
export function fileIconId(
	lookup: IconLookup,
	languages: readonly LanguageAssociations[],
	fileName: string,
): string | undefined {
	const name = fileName.toLowerCase()
	const extensions = extensionsOf(name)
	const language = languageOf(languages, name, extensions)

	return (
		pick(lookup, a => own(a.fileNames, name)) ??
		extensions.map(ext => pick(lookup, a => own(a.fileExtensions, ext))).find(Boolean) ??
		pick(lookup, a => own(a.languageIds, language)) ??
		pick(lookup, a => a.file)
	)
}

/** A folder's icon: by name, and otherwise the theme's default, open or closed. */
export function folderIconId(lookup: IconLookup, folderName: string, expanded: boolean): string | undefined {
	const name = folderName.toLowerCase()

	if (expanded) {
		return (
			pick(lookup, a => own(a.folderNamesExpanded, name)) ??
			pick(lookup, a => own(a.folderNames, name)) ??
			pick(lookup, a => a.folderExpanded) ??
			pick(lookup, a => a.folder)
		)
	}

	return pick(lookup, a => own(a.folderNames, name)) ?? pick(lookup, a => a.folder)
}

/** VS Code matches names without case, so the theme's names are made lowercase once, when it loads. */
export function normalizeDocument(document: IconThemeDocument): IconThemeDocument {
	return {
		...document,
		...normalize(document),
		light: normalize(document.light),
		highContrast: normalize(document.highContrast),
	}
}

/** The languages in the user's `files.associations`. Only the simple patterns: `*.ext` and plain file names. */
export function userLanguageAssociations(patterns: Readonly<Record<string, string>>): LanguageAssociations {
	const user: LanguageAssociations = { fileNames: new Map(), extensions: new Map() }

	for (const [pattern, language] of Object.entries(patterns)) {
		if (/^\*\.[^*?/{[]+$/.test(pattern)) {
			user.extensions.set(pattern.slice(1).toLowerCase(), language)
		} else if (!/[*?/{[]/.test(pattern)) {
			user.fileNames.set(pattern.toLowerCase(), language)
		}
	}

	return user
}

/** Theme fonts give their characters as CSS escapes, like `\E004`. */
export function unescapeCharacter(value: string): string {
	return value.replace(/\\([0-9a-f]{1,6}) ?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
}

/** Looks up a key the theme has itself, so a file named `constructor` doesn't find Object's. */
export function own<T>(record: Readonly<Record<string, T>> | undefined, key: string | undefined): T | undefined {
	return record && key !== undefined && Object.hasOwn(record, key) ? record[key] : undefined
}

/** The first icon the associations give, the light or high contrast ones first, skipping empty ones like VS Code. */
function pick(lookup: IconLookup, get: (associations: IconAssociations) => string | undefined): string | undefined {
	return lookup.associations.map(get).find(id => {
		const definition = own(lookup.definitions, id)
		return definition?.iconPath || definition?.fontCharacter
	})
}

/** A file's language: by name, then by extension, from the user's `files.associations` first. */
function languageOf(
	languages: readonly LanguageAssociations[],
	name: string,
	extensions: readonly string[],
): string | undefined {
	for (const associations of languages) {
		const language =
			associations.fileNames.get(name) ??
			extensions.map(ext => associations.extensions.get(`.${ext}`)).find(Boolean)

		if (language) {
			return language
		}
	}

	return undefined
}

/** The extensions of a file name, longest first: `d.ts` and then `ts` for `index.d.ts`. */
function extensionsOf(name: string): string[] {
	const segments = name.split('.').slice(1)
	return segments.map((_, i) => segments.slice(i).join('.'))
}

/** The associations with every name lowercase, for matching without case. */
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

/** The same record, with lowercase keys. */
function lowercaseKeys(record: Readonly<Record<string, string>> | undefined): Record<string, string> | undefined {
	return record && Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]))
}
