import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { themeColor } from '../src/helpers/shared.ts'

describe('themeColor', () => {
	test('turns a theme color ID into the CSS variable webviews have for it', () => {
		assert.equal(
			themeColor('gitDecoration.addedResourceForeground'),
			'var(--vscode-gitDecoration-addedResourceForeground)',
		)
	})

	test('replaces every dot', () => {
		assert.equal(themeColor('a.b.c'), 'var(--vscode-a-b-c)')
	})
})
