import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
	fileIconId,
	folderIconId,
	normalizeDocument,
	unescapeCharacter,
	userLanguageAssociations,
} from '../src/icons/iconMatching.ts'
import type { IconAssociations, IconLookup, IconThemeDocument, LanguageAssociations } from '../src/types/iconTheme.ts'

// Every icon the tests use, defined, except `_empty`, which is left empty like vscode-icons' light file icon.
const ICONS = [
	'_file',
	'_file_light',
	'_folder',
	'_folder_open',
	'_src',
	'_src_open',
	'_ts',
	'_dts',
	'_ts_light',
	'_json',
	'_package',
	'_typescript',
	'_python',
	'_docker',
]
const definitions = {
	...Object.fromEntries(ICONS.map(id => [id, { iconPath: `./${id}.svg` }])),
	_empty: { iconPath: '' },
}

const dark: IconAssociations = {
	file: '_file',
	folder: '_folder',
	folderExpanded: '_folder_open',
	folderNames: { src: '_src' },
	folderNamesExpanded: { src: '_src_open' },
	fileExtensions: { ts: '_ts', 'd.ts': '_dts', json: '_json' },
	fileNames: { 'package.json': '_package' },
	languageIds: { typescript: '_typescript', python: '_python', dockerfile: '_docker' },
}

function lookup(...associations: IconAssociations[]): IconLookup {
	return { associations: associations.length ? associations : [dark], definitions }
}

const languages: LanguageAssociations[] = [
	{ fileNames: new Map(), extensions: new Map([['.mts', 'typescript']]) },
	{
		fileNames: new Map([['dockerfile', 'dockerfile']]),
		extensions: new Map([
			['.py', 'python'],
			['.mts', 'javascript'],
		]),
	},
]

describe('fileIconId', () => {
	test('matches a file name before its extension', () => {
		assert.equal(fileIconId(lookup(), languages, 'package.json'), '_package')
		assert.equal(fileIconId(lookup(), languages, 'tsconfig.json'), '_json')
	})
	test('matches the longest extension first', () => {
		assert.equal(fileIconId(lookup(), languages, 'index.d.ts'), '_dts')
		assert.equal(fileIconId(lookup(), languages, 'index.ts'), '_ts')
	})
	test('falls back to the language, from the name or the extension', () => {
		assert.equal(fileIconId(lookup(), languages, 'main.py'), '_python')
		assert.equal(fileIconId(lookup(), languages, 'Dockerfile'), '_docker')
	})
	test("prefers the user's languages to the ones extensions contribute", () => {
		assert.equal(fileIconId(lookup(), languages, 'index.mts'), '_typescript')
	})
	test("falls back to the theme's default file icon", () => {
		assert.equal(fileIconId(lookup(), languages, 'notes.weird'), '_file')
		assert.equal(fileIconId(lookup(), languages, 'Makefile'), '_file')
	})
	test('matches without case', () => {
		assert.equal(
			fileIconId(lookup(normalizeDocument({ fileNames: { 'README.md': '_json' } })), [], 'readme.MD'),
			'_json',
		)
		assert.equal(fileIconId(lookup(), languages, 'INDEX.TS'), '_ts')
	})
	test("doesn't find Object's own properties", () => {
		assert.equal(fileIconId(lookup(), languages, 'constructor'), '_file')
		assert.equal(fileIconId(lookup(), languages, 'a.__proto__'), '_file')
	})
	test('uses the light icons first, and the dark ones for the rest', () => {
		const light: IconAssociations = { file: '_file_light', fileExtensions: { ts: '_ts_light' } }
		assert.equal(fileIconId(lookup(light, dark), languages, 'index.ts'), '_ts_light')
		assert.equal(fileIconId(lookup(light, dark), languages, 'package.json'), '_package')
		assert.equal(fileIconId(lookup(light, dark), languages, 'notes.weird'), '_file_light')
	})
	test('skips icons the theme leaves empty', () => {
		assert.equal(fileIconId(lookup({ file: '_empty' }, dark), languages, 'notes.weird'), '_file')
		assert.equal(fileIconId(lookup({ fileExtensions: { ts: '_missing' } }, dark), languages, 'a.ts'), '_ts')
	})
	test('has no icon without a theme', () => {
		assert.equal(fileIconId({ associations: [], definitions: undefined }, languages, 'index.ts'), undefined)
	})
})

describe('folderIconId', () => {
	test('matches a folder by name, open and closed', () => {
		assert.equal(folderIconId(lookup(), 'src', false), '_src')
		assert.equal(folderIconId(lookup(), 'src', true), '_src_open')
		assert.equal(folderIconId(lookup(), 'SRC', true), '_src_open')
	})
	test("falls back to the theme's default folder icons", () => {
		assert.equal(folderIconId(lookup(), 'docs', false), '_folder')
		assert.equal(folderIconId(lookup(), 'docs', true), '_folder_open')
	})
	test('uses the closed icons when the theme has no open ones', () => {
		const closedOnly: IconAssociations = { folder: '_folder', folderNames: { src: '_src' } }
		assert.equal(folderIconId(lookup(closedOnly), 'src', true), '_src')
		assert.equal(folderIconId(lookup(closedOnly), 'docs', true), '_folder')
	})
	test('has no icon when the theme has no folder icons, like Seti', () => {
		assert.equal(folderIconId(lookup({ file: '_file' }), 'docs', true), undefined)
	})
})

describe('normalizeDocument', () => {
	test('makes every name lowercase, also in the light and high contrast icons', () => {
		const document: IconThemeDocument = {
			fileNames: { 'Package.JSON': '_package' },
			fileExtensions: { TS: '_ts' },
			folderNames: { Src: '_src' },
			folderNamesExpanded: { Src: '_src_open' },
			languageIds: { typescript: '_typescript' },
			light: { fileNames: { 'README.md': '_file_light' } },
			highContrast: { folderNames: { Docs: '_folder' } },
		}
		assert.deepEqual(normalizeDocument(document), {
			fileNames: { 'package.json': '_package' },
			fileExtensions: { ts: '_ts' },
			folderNames: { src: '_src' },
			folderNamesExpanded: { src: '_src_open' },
			languageIds: { typescript: '_typescript' },
			light: {
				fileNames: { 'readme.md': '_file_light' },
				fileExtensions: undefined,
				folderNames: undefined,
				folderNamesExpanded: undefined,
			},
			highContrast: {
				fileNames: undefined,
				fileExtensions: undefined,
				folderNames: { docs: '_folder' },
				folderNamesExpanded: undefined,
			},
		})
	})
})

describe('unescapeCharacter', () => {
	test('turns a CSS escape into its character', () => {
		assert.equal(unescapeCharacter('\\E004'), '')
		assert.equal(unescapeCharacter('\\e004 '), '')
		assert.equal(unescapeCharacter('\\1F600'), '😀')
	})
	test('leaves a plain character as it is', () => {
		assert.equal(unescapeCharacter('A'), 'A')
	})
})

describe('userLanguageAssociations', () => {
	test('reads extensions and file names, without case', () => {
		const user = userLanguageAssociations({ '*.MDX': 'markdown', Jenkinsfile: 'groovy' })
		assert.deepEqual(user.extensions, new Map([['.mdx', 'markdown']]))
		assert.deepEqual(user.fileNames, new Map([['jenkinsfile', 'groovy']]))
	})
	test('leaves out other patterns', () => {
		const user = userLanguageAssociations({
			'**/*.conf': 'ini',
			'src/*.js': 'javascript',
			'*.{a,b}': 'c',
			'x?.y': 'z',
		})
		assert.deepEqual(user.extensions, new Map())
		assert.deepEqual(user.fileNames, new Map())
	})
})
