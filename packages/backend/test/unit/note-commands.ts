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
		assert.match(lines[0], /^\/dice1d6 = \(\$\[bg\.color=fff5a0 \d+\]\)$/);
		assert.match(lines[1], /^\/choice1 A B C = \(\$\[bg\.color=fff5a0 [ABC]\]\)$/);
	});

	test('1ノート内に31件以上のコマンドがある場合、31件目以降は未展開のまま残る', () => {
		const lines = Array.from({ length: 31 }, () => '/dice1d6');
		const result = applyNoteCommands(lines.join('\n'));
		assert.ok(result);
		const resultLines = result!.split('\n');
		assert.strictEqual(resultLines.length, 31);
		for (let i = 0; i < 30; i++) {
			assert.match(resultLines[i], /^\/dice1d6 = \(\$\[bg\.color=fff5a0 \d+\]\)$/, `line ${i} should be expanded`);
		}
		assert.strictEqual(resultLines[30], '/dice1d6', 'line 30 should remain unexpanded');
	});

	test('展開結果が3000文字を超える場合、原文がそのまま返る', () => {
		// 長い選択肢1件を choicex (重複可) で100回選出させ、原文は短いが展開後に3000文字を超えるようにする
		const longChoice = '選択肢その1234567890選択肢その1234567890選択肢その1234567890';
		const original = `/choicex100 ${longChoice}`;
		const result = applyNoteCommands(original);
		assert.strictEqual(result, original);
	});
});
