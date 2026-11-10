import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { onBranch, repository, worktree } from './fakes.ts'
import {
	applyOrder,
	byName,
	folderIndex,
	mainRepositoryPath,
	moveInOrder,
	repositoryName,
	sortRepositories,
} from '../src/model/repositories.ts'
import type { Repository } from '../src/types/git.ts'

describe('repositoryName and byName', () => {
	test('names a repository after its folder', () => {
		assert.equal(repositoryName(repository({})), 'repo')
	})
	test('sorts repositories by their name', () => {
		const sorted = [onBranch(undefined, '/b/web'), onBranch(undefined, '/a/api')].sort(byName)
		assert.deepEqual(sorted.map(repositoryName), ['api', 'web'])
	})
})

describe('mainRepositoryPath, folderIndex and sortRepositories', () => {
	test('knows the repository a worktree belongs to', () => {
		assert.equal(mainRepositoryPath(worktree('/code/feature-x', '/code/api')), '/code/api')
		assert.equal(mainRepositoryPath(onBranch(undefined, '/code/api')), undefined)
	})
	test('puts each worktree right after its repository', () => {
		const sorted = sortRepositories([
			onBranch(undefined, '/code/web'),
			worktree('/code/zz-fix', '/code/api'),
			onBranch(undefined, '/code/api'),
			worktree('/code/feature-x', '/code/api'),
		])
		assert.deepEqual(sorted.map(repositoryName), ['api', 'feature-x', 'zz-fix', 'web'])
	})
	test("sorts a worktree by its own name when its repository isn't open", () => {
		const sorted = sortRepositories([onBranch(undefined, '/code/web'), worktree('/code/feature-x', '/code/api')])
		assert.deepEqual(sorted.map(repositoryName), ['feature-x', 'web'])
	})
	test("finds a repository's folder, also when the folder is part of the repository", () => {
		const folders = ['/code/web', '/code/api/src', '/other']
		assert.equal(folderIndex(onBranch(undefined, '/code/web'), folders), 0)
		assert.equal(folderIndex(onBranch(undefined, '/code/api'), folders), 1)
		assert.equal(folderIndex(onBranch(undefined, '/other/tools'), folders), 2)
		assert.equal(folderIndex(onBranch(undefined, '/code/webapp'), folders), 3)
	})
	test("sorts repositories in the workspace's folder order, and by name within a folder", () => {
		const sorted = sortRepositories(
			[
				onBranch(undefined, '/elsewhere/a'),
				onBranch(undefined, '/code/web'),
				onBranch(undefined, '/libs/zod'),
				onBranch(undefined, '/libs/axios'),
				onBranch(undefined, '/code/api'),
			],
			['/code/web', '/libs', '/code/api'],
		)
		assert.deepEqual(sorted.map(repositoryName), ['web', 'axios', 'zod', 'api', 'a'])
	})
	test('keeps a worktree after its repository, wherever its own folder is', () => {
		const sorted = sortRepositories(
			[
				onBranch(undefined, '/code/web'),
				onBranch(undefined, '/code/api'),
				worktree('/code/feature-x', '/code/api'),
			],
			['/code/feature-x', '/code/web', '/code/api'],
		)
		assert.deepEqual(sorted.map(repositoryName), ['web', 'api', 'feature-x'])
	})
})

describe('applyOrder and moveInOrder', () => {
	const [api, web, docs, tools] = ['/code/api', '/code/web', '/code/docs', '/code/tools'].map(p =>
		onBranch(undefined, p),
	)
	const uriOf = (repository: Repository) => repository.rootUri.toString()

	test('puts repositories in the saved order', () => {
		const ordered = applyOrder([api, docs, web], [web, api, docs].map(uriOf))
		assert.deepEqual(ordered.map(repositoryName), ['web', 'api', 'docs'])
	})
	test("puts a repository that isn't in the saved order after the one it comes after", () => {
		const ordered = applyOrder([api, docs, tools, web], [web, api, tools].map(uriOf))
		assert.deepEqual(ordered.map(repositoryName), ['web', 'api', 'docs', 'tools'])
	})
	test('puts one that comes first first, and leaves out saved ones that are closed', () => {
		const ordered = applyOrder([api, web], ['file:///code/gone', uriOf(web)])
		assert.deepEqual(ordered.map(repositoryName), ['api', 'web'])
	})
	test('keeps the sorted order without a saved one', () => {
		assert.deepEqual(applyOrder([api, web], []).map(repositoryName), ['api', 'web'])
	})
	test('moves a repository before or after another', () => {
		const order = ['a', 'b', 'c', 'd']
		assert.deepEqual(moveInOrder(order, 'd', 'b', false), ['a', 'd', 'b', 'c'])
		assert.deepEqual(moveInOrder(order, 'a', 'c', true), ['b', 'c', 'a', 'd'])
		assert.deepEqual(moveInOrder(order, 'b', 'd', true), ['a', 'c', 'd', 'b'])
	})
	test('leaves the order alone when the target is itself or not in it', () => {
		assert.deepEqual(moveInOrder(['a', 'b'], 'a', 'a', true), ['a', 'b'])
		assert.deepEqual(moveInOrder(['a', 'b'], 'a', 'x', true), ['a', 'b'])
	})
	test('keeps worktrees after their repository in the saved order', () => {
		const featureX = worktree('/code/feature-x', '/code/api')
		const sorted = sortRepositories([api, web, featureX], [], [web, api].map(uriOf))
		assert.deepEqual(sorted.map(repositoryName), ['web', 'api', 'feature-x'])
	})
})
