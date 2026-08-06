/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'assert';
import { describe, test } from 'vitest';
import diceCommandsProcessor from '@/misc/note-commands/dice.js';
import type { NoteCommandContext } from '@/misc/note-commands/types.js';

function run(body: string, budget = 30): string {
	const ctx: NoteCommandContext = { remainingBudget: budget };
	return diceCommandsProcessor.processor(body, ctx);
}

describe('note-commands dice', () => {
	test('/dice2d6 は合計値を MFM で埋め込む', () => {
		const result = run('/dice2d6');
		const m = result.match(/^\/dice2d6 = \(\$\[bg\.color=ff0000 (\d+)\]\)$/);
		assert.ok(m, `unexpected format: ${result}`);
		const total = Number(m![1]);
		assert.ok(total >= 2 && total <= 12, `out of range: ${total}`);
	});

	test('/dice3b6 はバラ目と合計を MFM で埋め込む', () => {
		const result = run('/dice3b6');
		const m = result.match(/^\/dice3b6 = \(\$\[bg\.color=ff0000 (\d+), (\d+), (\d+) \((\d+)\)\]\)$/);
		assert.ok(m, `unexpected format: ${result}`);
		const [r1, r2, r3, total] = m!.slice(1).map(Number);
		for (const r of [r1, r2, r3]) {
			assert.ok(r >= 1 && r <= 6, `out of range: ${r}`);
		}
		assert.strictEqual(r1 + r2 + r3, total);
	});

	test('/dd は 1〜100 の範囲に展開される', () => {
		const result = run('/dd');
		const m = result.match(/^\/dd = \(\$\[bg\.color=ff0000 (\d+)\]\)$/);
		assert.ok(m, `unexpected format: ${result}`);
		const v = Number(m![1]);
		assert.ok(v >= 1 && v <= 100, `out of range: ${v}`);
	});

	test('ロール回数 0 はエラー表記になる', () => {
		const result = run('/dice0d6');
		assert.match(result, /\$\[bg\.color=ffb3b3 error: 不正な数値指定です\]/);
	});

	test('ロール回数 101 はエラー表記になる(多すぎる)', () => {
		const result = run('/dice101d6');
		assert.match(result, /\$\[bg\.color=ffb3b3 error: ロール回数が多すぎます\]/);
	});

	test('ダイス面数 0 はエラー表記になる', () => {
		const result = run('/dice1d0');
		assert.match(result, /\$\[bg\.color=ffb3b3 error: 不正な数値指定です\]/);
	});

	test('ダイス面数 1000001 はエラー表記になる(大きすぎる)', () => {
		const result = run('/dice1d1000001');
		assert.match(result, /\$\[bg\.color=ffb3b3 error: ダイスの目が大きすぎます\]/);
	});

	test('複数行のダイスコマンドをそれぞれ独立して展開する', () => {
		const result = run('/dice1d6\n/dice1d20');
		const lines = result.split('\n');
		assert.match(lines[0], /^\/dice1d6 = \(\$\[bg\.color=ff0000 \d+\]\)$/);
		assert.match(lines[1], /^\/dice1d20 = \(\$\[bg\.color=ff0000 \d+\]\)$/);
	});

	test('コマンドを含まない通常テキストは変化しない', () => {
		assert.strictEqual(run('こんにちは、世界'), 'こんにちは、世界');
	});

	test('remainingBudget が 0 の場合は展開しない', () => {
		const result = run('/dice1d6', 0);
		assert.strictEqual(result, '/dice1d6');
	});

	test('展開のたびに remainingBudget を消費する', () => {
		const ctx: NoteCommandContext = { remainingBudget: 1 };
		const result = diceCommandsProcessor.processor('/dice1d6\n/dice1d6', ctx);
		assert.strictEqual(ctx.remainingBudget, 0);
		const lines = result.split('\n');
		assert.match(lines[0], /\$\[bg\.color=ff0000 \d+\]/);
		assert.strictEqual(lines[1], '/dice1d6');
	});
});
