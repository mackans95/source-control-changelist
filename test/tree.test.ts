import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { change, repository } from './fakes.ts'
import { buildTree, byPath } from '../src/model/tree.ts'
import type { FolderNode, ResourceNode } from '../src/types/extension.ts'

// The tree as nested labels: a folder as `{ label: children }`, a file as its name.
function shape(nodes: readonly (FolderNode | ResourceNode)[]): unknown[] {
	return nodes.map(n =>
		n.type === 'folder' ? { [n.label]: shape(n.children) } : n.change.uri.path.split('/').pop()!,
	)
}

describe('buildTree', () => {
	const tree = (...paths: string[]) =>
		buildTree(
			repository({}),
			'changes',
			paths.map(p => change(p)),
		)

	test('puts files at the root next to the folders', () => {
		assert.deepEqual(shape(tree('README.md', 'src/a.ts')), [{ src: ['a.ts'] }, 'README.md'])
	})
	test('joins folders that only hold one folder', () => {
		assert.deepEqual(shape(tree('src/app/main/a.ts')), [{ 'src/app/main': ['a.ts'] }])
	})
	test('stops joining at a folder with files or several folders', () => {
		assert.deepEqual(shape(tree('src/a.ts', 'src/app/b.ts', 'src/lib/util/c.ts')), [
			{ src: [{ app: ['b.ts'] }, { 'lib/util': ['c.ts'] }, 'a.ts'] },
		])
	})
	test('sorts folders and files by name, folders first', () => {
		assert.deepEqual(shape(tree('b.ts', 'z/x.ts', 'a.ts', 'm/y.ts')), [
			{ m: ['y.ts'] },
			{ z: ['x.ts'] },
			'a.ts',
			'b.ts',
		])
	})
	test('gives each folder its URI and the changes below it', () => {
		const [folder] = tree('src/app/a.ts', 'src/app/deep/b.ts') as FolderNode[]
		assert.equal(folder.uri.path, '/repo/src/app')
		assert.deepEqual(
			folder.changes.map(c => c.uri.path),
			['/repo/src/app/deep/b.ts', '/repo/src/app/a.ts'],
		)
		assert.equal((folder.children[0] as FolderNode).uri.path, '/repo/src/app/deep')
	})
	test('keeps the group and repository on every node', () => {
		const [folder] = tree('src/a.ts') as FolderNode[]
		const [file] = folder.children as ResourceNode[]
		assert.equal(folder.kind, 'changes')
		assert.equal(file.kind, 'changes')
		assert.equal(file.repository, folder.repository)
	})
})

describe('byPath', () => {
	test('sorts changes by their path', () => {
		const sorted = [change('b.ts'), change('a/c.ts'), change('a.ts')].sort(byPath)
		assert.deepEqual(
			sorted.map(c => c.uri.path),
			['/repo/a.ts', '/repo/a/c.ts', '/repo/b.ts'],
		)
	})
})
