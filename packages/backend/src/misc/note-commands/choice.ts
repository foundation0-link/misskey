/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { pickIndex } from './random.js';
import type { NoteCommandContext, Processor } from './types.js';

const SUCCESS_COLOR = '0000ff';
const ERROR_COLOR = 'ffb3b3';
const MAX_PICK_COUNT = 100;

function success(text: string): string {
	return `($[bg.color=${SUCCESS_COLOR} ${text}])`;
}

function error(message: string): string {
	return `($[bg.color=${ERROR_COLOR} error: ${message}])`;
}

function splitChoices(line: string): string[] {
	return line.trim().split(/[\s,]+/).filter(s => s.length > 0);
}

/**
 * チョイス系コマンドを処理するprocessor
 */
const choiceCommandsProcessor: Processor = {
	name: 'choiceCommands',
	processor(body: string, ctx: NoteCommandContext): string {
		// 完全ランダムチョイスコマンド(重複許可)(例: /choicex1 A B C または /ccx1 A B C)を処理(複数行対応)
		body = body.replace(/^\/(choicex|ccx)(\d+)\s+(.+)$/gm, (match, _, count, line) => {
			if (ctx.remainingBudget <= 0) return match;
			const choiceCount = parseInt(count, 10);
			const choices = splitChoices(line);

			// choiceCount の上限チェックは Array.from({ length: choiceCount }) より必ず先に評価すること。
			// 順序を入れ替えると、choiceCount が極端に大きい値(桁あふれで Infinity 化した場合等)のときに
			// RangeError でノート投稿全体がクラッシュする。
			if (choiceCount <= 0 || choiceCount > MAX_PICK_COUNT || choices.length === 0) {
				ctx.remainingBudget--;
				return `${match} = ${error('不正な指定です')}`;
			}

			// 重複を許すランダムセレクション
			const selectedChoices = Array.from(
				{ length: choiceCount },
				() => choices[pickIndex(choices.length)],
			);
			ctx.remainingBudget--;
			return `${match} = ${success(selectedChoices.join(', '))}`;
		});

		// ユニークランダムチョイスコマンド(例: /choice1 A B C または /cc1 A B C)を処理(複数行対応)
		body = body.replace(/^\/(choice|cc)(\d+)\s+(.+)$/gm, (match, _, count, line) => {
			if (ctx.remainingBudget <= 0) return match;
			const choiceCount = parseInt(count, 10);
			const choices = splitChoices(line);

			if (choiceCount <= 0 || choices.length < choiceCount) {
				ctx.remainingBudget--;
				return `${match} = ${error('不正な指定です')}`;
			}

			// Fisher-Yatesシャッフルで重複なしのランダムセレクション
			const shuffled = [...choices];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = pickIndex(i + 1);
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}
			const selectedChoices = shuffled.slice(0, choiceCount);
			ctx.remainingBudget--;
			return `${match} = ${success(selectedChoices.join(', '))}`;
		});

		return body;
	},
};

export default choiceCommandsProcessor;
