/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { rollDie } from './random.js';
import type { NoteCommandContext, Processor } from './types.js';

const SUCCESS_COLOR = '0000ff';
const ERROR_COLOR = 'ffb3b3';
const MAX_ROLL_COUNT = 100;
const MAX_DICE_SIDES = 1000000;

function success(text: string): string {
	return `($[bg.color=${SUCCESS_COLOR} ${text}])`;
}

function error(message: string): string {
	return `($[bg.color=${ERROR_COLOR} error: ${message}])`;
}

function validate(rollCount: number, diceSize: number): string | null {
	if (rollCount <= 0 || diceSize <= 0) {
		return error('不正な数値指定です');
	}
	if (rollCount > MAX_ROLL_COUNT) {
		return error('ロール回数が多すぎます');
	}
	if (diceSize > MAX_DICE_SIDES) {
		return error('ダイスの目が大きすぎます');
	}
	return null;
}

/**
 * ダイス系コマンドを処理するprocessor
 */
const diceCommandsProcessor: Processor = {
	name: 'diceCommands',
	processor(body: string, ctx: NoteCommandContext): string {
		// 通常のダイスコマンド(例: /dice2d6)を処理(複数行対応)
		body = body.replace(/^\/dice(\d+)d(\d+)/gm, (match, count, sides) => {
			if (ctx.remainingBudget <= 0) return match;
			const rollCount = parseInt(count, 10);
			const diceSize = parseInt(sides, 10);

			const validationError = validate(rollCount, diceSize);
			if (validationError) {
				ctx.remainingBudget--;
				return `${match} = ${validationError}`;
			}

			const rolls: number[] = [];
			for (let i = 0; i < rollCount; i++) {
				rolls.push(rollDie(diceSize));
			}
			const total = rolls.reduce((a, b) => a + b, 0);
			ctx.remainingBudget--;
			return `${match} = ${success(String(total))}`;
		});

		// ダイスコマンド短縮形(例: /2d6)を処理(複数行対応)
		body = body.replace(/^\/(\d+)d(\d+)/gm, (match, count, sides) => {
			if (ctx.remainingBudget <= 0) return match;
			const rollCount = parseInt(count, 10);
			const diceSize = parseInt(sides, 10);

			const validationError = validate(rollCount, diceSize);
			if (validationError) {
				ctx.remainingBudget--;
				return `${match} = ${validationError}`;
			}

			const rolls: number[] = [];
			for (let i = 0; i < rollCount; i++) {
				rolls.push(rollDie(diceSize));
			}
			const total = rolls.reduce((a, b) => a + b, 0);
			ctx.remainingBudget--;
			return `${match} = ${success(String(total))}`;
		});

		// バラバラダイスコマンド(例: /dice3b6)を処理(複数行対応)
		body = body.replace(/^\/dice(\d+)b(\d+)/gm, (match, count, sides) => {
			if (ctx.remainingBudget <= 0) return match;
			const rollCount = parseInt(count, 10);
			const diceSize = parseInt(sides, 10);

			const validationError = validate(rollCount, diceSize);
			if (validationError) {
				ctx.remainingBudget--;
				return `${match} = ${validationError}`;
			}

			const rolls: number[] = [];
			for (let i = 0; i < rollCount; i++) {
				rolls.push(rollDie(diceSize));
			}
			const total = rolls.reduce((a, b) => a + b, 0);
			ctx.remainingBudget--;
			return `${match} = ${success(`${rolls.join(', ')} (${total})`)}`;
		});

		// バラバラダイスコマンド短縮形(例: /3b6)を処理(複数行対応)
		body = body.replace(/^\/(\d+)b(\d+)/gm, (match, count, sides) => {
			if (ctx.remainingBudget <= 0) return match;
			const rollCount = parseInt(count, 10);
			const diceSize = parseInt(sides, 10);

			const validationError = validate(rollCount, diceSize);
			if (validationError) {
				ctx.remainingBudget--;
				return `${match} = ${validationError}`;
			}

			const rolls: number[] = [];
			for (let i = 0; i < rollCount; i++) {
				rolls.push(rollDie(diceSize));
			}
			const total = rolls.reduce((a, b) => a + b, 0);
			ctx.remainingBudget--;
			return `${match} = ${success(`${rolls.join(', ')} (${total})`)}`;
		});

		// 行先頭の /dd のみを処理(複数行対応)
		// 別名:クイックダイス = /dice1d100 と同等
		body = body.replace(/^\/dd/gm, (match) => {
			if (ctx.remainingBudget <= 0) return match;
			const total = rollDie(100);
			ctx.remainingBudget--;
			return `${match} = ${success(String(total))}`;
		});

		return body;
	},
};

export default diceCommandsProcessor;
