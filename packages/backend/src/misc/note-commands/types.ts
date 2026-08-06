/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export interface NoteCommandContext {
	remainingBudget: number;
}

export interface Processor {
	name: string;
	processor(body: string, ctx: NoteCommandContext): string;
}
