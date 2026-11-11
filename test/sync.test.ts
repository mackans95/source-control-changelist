import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { onBranch, upstream } from './fakes.ts'
import { gitErrorMessage, needsPull, needsSync, syncState } from '../src/model/sync.ts'

describe('syncState and needsSync', () => {
	test('compares the branch with its upstream', () => {
		assert.equal(syncState(onBranch({ name: 'main', upstream, ahead: 0, behind: 0 })), 'synced')
		assert.equal(syncState(onBranch({ name: 'main', upstream, ahead: 2, behind: 0 })), 'ahead')
		assert.equal(syncState(onBranch({ name: 'main', upstream, ahead: 0, behind: 1 })), 'behind')
		assert.equal(syncState(onBranch({ name: 'main', upstream, ahead: 2, behind: 1 })), 'diverged')
	})
	test('treats missing counts as none', () => {
		assert.equal(syncState(onBranch({ name: 'main', upstream })), 'synced')
	})
	test('knows a branch without an upstream, and a detached HEAD', () => {
		assert.equal(syncState(onBranch({ name: 'feature', ahead: 3 })), 'unpublished')
		assert.equal(syncState(onBranch({ commit: 'abc' })), 'detached')
		assert.equal(syncState(onBranch(undefined)), 'detached')
	})
	test('needs a sync with commits to push or pull', () => {
		assert.equal(needsSync(onBranch({ name: 'main', upstream, ahead: 1 })), true)
		assert.equal(needsSync(onBranch({ name: 'main', upstream, behind: 1 })), true)
		assert.equal(needsSync(onBranch({ name: 'main', upstream, ahead: 2, behind: 1 })), true)
	})
	test('needs a pull when behind or diverged', () => {
		assert.equal(needsPull(onBranch({ name: 'main', upstream, behind: 1 })), true)
		assert.equal(needsPull(onBranch({ name: 'main', upstream, ahead: 2, behind: 1 })), true)
		assert.equal(needsPull(onBranch({ name: 'main', upstream, ahead: 1 })), false)
	})
	test('needs no sync when up to date, unpublished or detached', () => {
		assert.equal(needsSync(onBranch({ name: 'main', upstream })), false)
		assert.equal(needsSync(onBranch({ name: 'feature', ahead: 3 })), false)
		assert.equal(needsSync(onBranch({ commit: 'abc' })), false)
	})
})

describe('gitErrorMessage', () => {
	test("picks Git's fatal line over its hints", () => {
		const stderr = [
			'hint: You have divergent branches and need to specify how to reconcile them.',
			'hint:   git config pull.rebase false  # merge',
			'fatal: Need to specify how to reconcile divergent branches.',
		].join('\n')
		assert.equal(gitErrorMessage({ stderr }), 'Need to specify how to reconcile divergent branches.')
	})
	test("uses Git's last line when it has no fatal or error line", () => {
		const stderr = 'hint: something to know\nCould not read from remote repository.\n'
		assert.equal(gitErrorMessage({ stderr }), 'Could not read from remote repository.')
	})
	test("uses the error's message when Git said nothing", () => {
		assert.equal(gitErrorMessage(new Error('Failed to execute git')), 'Failed to execute git')
	})
})
