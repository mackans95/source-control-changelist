// How each of a file's statuses looks in the view: the same letters, colors and texts as the Git
// extension's in the built-in Source Control view.
import { Status } from './git.ts'
import type { StatusDecoration } from '../types/extension.ts'

// By status.
export const STATUS_DECORATIONS: Record<(typeof Status)[keyof typeof Status], StatusDecoration> = {
	[Status.INDEX_MODIFIED]: {
		letter: 'M',
		color: 'gitDecoration.stageModifiedResourceForeground',
		text: 'Index Modified',
		strikethrough: false,
	},
	[Status.INDEX_ADDED]: {
		letter: 'A',
		color: 'gitDecoration.addedResourceForeground',
		text: 'Index Added',
		strikethrough: false,
	},
	[Status.INDEX_DELETED]: {
		letter: 'D',
		color: 'gitDecoration.stageDeletedResourceForeground',
		text: 'Index Deleted',
		strikethrough: true,
	},
	[Status.INDEX_RENAMED]: {
		letter: 'R',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Index Renamed',
		strikethrough: false,
	},
	[Status.INDEX_COPIED]: {
		letter: 'C',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Index Copied',
		strikethrough: false,
	},
	[Status.MODIFIED]: {
		letter: 'M',
		color: 'gitDecoration.modifiedResourceForeground',
		text: 'Modified',
		strikethrough: false,
	},
	[Status.DELETED]: {
		letter: 'D',
		color: 'gitDecoration.deletedResourceForeground',
		text: 'Deleted',
		strikethrough: true,
	},
	[Status.UNTRACKED]: {
		letter: 'U',
		color: 'gitDecoration.untrackedResourceForeground',
		text: 'Untracked',
		strikethrough: false,
	},
	[Status.IGNORED]: {
		letter: 'I',
		color: 'gitDecoration.ignoredResourceForeground',
		text: 'Ignored',
		strikethrough: false,
	},
	[Status.INTENT_TO_ADD]: {
		letter: 'A',
		color: 'gitDecoration.addedResourceForeground',
		text: 'Intent to Add',
		strikethrough: false,
	},
	[Status.INTENT_TO_RENAME]: {
		letter: 'R',
		color: 'gitDecoration.renamedResourceForeground',
		text: 'Intent to Rename',
		strikethrough: false,
	},
	[Status.TYPE_CHANGED]: {
		letter: 'T',
		color: 'gitDecoration.modifiedResourceForeground',
		text: 'Type Changed',
		strikethrough: false,
	},
	[Status.ADDED_BY_US]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Added By Us',
		strikethrough: false,
	},
	[Status.ADDED_BY_THEM]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Added By Them',
		strikethrough: false,
	},
	[Status.DELETED_BY_US]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Deleted By Us',
		strikethrough: true,
	},
	[Status.DELETED_BY_THEM]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Deleted By Them',
		strikethrough: true,
	},
	[Status.BOTH_ADDED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Added',
		strikethrough: false,
	},
	[Status.BOTH_DELETED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Deleted',
		strikethrough: true,
	},
	[Status.BOTH_MODIFIED]: {
		letter: '!',
		color: 'gitDecoration.conflictingResourceForeground',
		text: 'Conflict: Both Modified',
		strikethrough: false,
	},
}
