/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'assert';
import { describe, test } from 'vitest';
import { applyNoteCommands } from '@/misc/note-commands/index.js';

describe('applyNoteCommands', () => {
	test('text が null の場合 null を返す', () => {
		assert.strictEqual(applyNoteCommands(null), null);
	});

	test('コマンドを含まない通常テキストは変化しない', () => {
		assert.strictEqual(applyNoteCommands('こんにちは、世界'), 'こんにちは、世界');
	});

	test('ダイスコマンドとチョイスコマンドが同一本文に混在しても両方展開される', () => {
		const result = applyNoteCommands('/dice1d6\n/choice1 A B C');
		assert.ok(result);
		const lines = result!.split('\n');
		assert.match(lines[0], /^\/dice1d6 = \(\$\[bg\.color=0000ff \d+\]\)$/);
		assert.match(lines[1], /^\/choice1 A B C = \(\$\[bg\.color=0000ff [ABC]\]\)$/);
	});

	test('1ノート内に31件以上のコマンドがある場合、31件目以降は未展開のまま残る', () => {
		const lines = Array.from({ length: 31 }, () => '/dice1d6');
		const result = applyNoteCommands(lines.join('\n'));
		assert.ok(result);
		const resultLines = result!.split('\n');
		assert.strictEqual(resultLines.length, 31);
		for (let i = 0; i < 30; i++) {
			assert.match(resultLines[i], /^\/dice1d6 = \(\$\[bg\.color=0000ff \d+\]\)$/, `line ${i} should be expanded`);
		}
		assert.strictEqual(resultLines[30], '/dice1d6', 'line 30 should remain unexpanded');
	});

	test('dice系とchoice系が混在してもbudgetは横断的に共有され、31件目以降は未展開のまま残る', () => {
		// processors は index.ts で choiceCommandsProcessor → diceCommandsProcessor の順に
		// 本文全体へ適用される。そのため remainingBudget の消費順は「本文中の行の出現順」ではなく
		// 「processor の適用順」になる。本文の後半にある choice 系15件が先に全件展開されて
		// budget を15件分消費し、diceCommandsProcessor は残り15件分の budget しか使えないため、
		// 本文の前半にある dice系20件のうち後方5件(16〜20件目)が未展開のまま残る。
		const diceLines = Array.from({ length: 20 }, () => '/dice1d6');
		const choiceLines = Array.from({ length: 15 }, () => '/choice1 A B C');
		const lines = [...diceLines, ...choiceLines];
		const result = applyNoteCommands(lines.join('\n'));
		assert.ok(result);
		const resultLines = result!.split('\n');
		assert.strictEqual(resultLines.length, 35);

		// dice系の前方15件(budget残り分)は展開される
		for (let i = 0; i < 15; i++) {
			assert.match(resultLines[i], /^\/dice1d6 = \(\$\[bg\.color=0000ff \d+\]\)$/, `dice line ${i} should be expanded`);
		}
		// dice系の後方5件(16〜20件目)はbudget枯渇後のため未展開のまま残る
		for (let i = 15; i < 20; i++) {
			assert.strictEqual(resultLines[i], '/dice1d6', `dice line ${i} should remain unexpanded`);
		}
		// choice系15件はchoiceCommandsProcessorが先に処理するため全件展開される
		for (let i = 20; i < 35; i++) {
			assert.match(resultLines[i], /^\/choice1 A B C = \(\$\[bg\.color=0000ff [ABC]\]\)$/, `choice line ${i} should be expanded`);
		}
	});

	test('展開結果が3000文字を超える場合、原文がそのまま返る', () => {
		// 長い選択肢1件を choicex (重複可) で100回選出させ、原文は短いが展開後に3000文字を超えるようにする
		const longChoice = '選択肢その1234567890選択肢その1234567890選択肢その1234567890';
		const original = `/choicex100 ${longChoice}`;
		const result = applyNoteCommands(original);
		assert.strictEqual(result, original);
	});
});
