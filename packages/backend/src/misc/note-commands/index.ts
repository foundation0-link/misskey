/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MAX_NOTE_TEXT_LENGTH } from '@/const.js';
import choiceCommandsProcessor from './choice.js';
import diceCommandsProcessor from './dice.js';
import type { NoteCommandContext, Processor } from './types.js';

const processors: Processor[] = [
	choiceCommandsProcessor,
	diceCommandsProcessor,
];

const TOTAL_COMMAND_BUDGET = 30;

export function applyNoteCommands(text: string | null): string | null {
	if (text == null) return text;

	const ctx: NoteCommandContext = { remainingBudget: TOTAL_COMMAND_BUDGET };
	let body = text;
	for (const p of processors) {
		body = p.processor(body, ctx);
	}

	if (body.length > MAX_NOTE_TEXT_LENGTH) {
		return text;
	}

	return body;
}
