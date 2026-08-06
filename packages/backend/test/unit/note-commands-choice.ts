/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'assert';
import { describe, test } from 'vitest';
import choiceCommandsProcessor from '@/misc/note-commands/choice.js';
import type { NoteCommandContext } from '@/misc/note-commands/types.js';

function run(body: string, budget = 30): string {
	const ctx: NoteCommandContext = { remainingBudget: budget };
	return choiceCommandsProcessor.processor(body, ctx);
}

describe('note-commands choice', () => {
	test('/choice2 A B C は重複なしで2件選ぶ', () => {
		const result = run('/choice2 A B C');
		const m = result.match(/^\/choice2 A B C = \(\$\[bg\.color=fff5a0 (.+)\]\)$/);
		assert.ok(m, `unexpected format: ${result}`);
		const picked = m![1].split(', ');
		assert.strictEqual(picked.length, 2);
		assert.strictEqual(new Set(picked).size, 2);
		for (const p of picked) {
			assert.ok(['A', 'B', 'C'].includes(p), `unexpected choice: ${p}`);
		}
	});

	test('/cc2 A B C は /choice2 の別名として機能する', () => {
		const result = run('/cc2 A B C');
		assert.match(result, /^\/cc2 A B C = \(\$\[bg\.color=fff5a0 .+\]\)$/);
	});

	test('/choicex3 A B は重複ありで3件選ぶ', () => {
		const result = run('/choicex3 A B');
		const m = result.match(/^\/choicex3 A B = \(\$\[bg\.color=fff5a0 (.+)\]\)$/);
		assert.ok(m, `unexpected format: ${result}`);
		const picked = m![1].split(', ');
		assert.strictEqual(picked.length, 3);
		for (const p of picked) {
			assert.ok(['A', 'B'].includes(p), `unexpected choice: ${p}`);
		}
	});

	test('/ccx3 A B は /choicex3 の別名として機能する', () => {
		const result = run('/ccx3 A B');
		assert.match(result, /^\/ccx3 A B = \(\$\[bg\.color=fff5a0 .+\]\)$/);
	});

	test('選択数が選択肢総数を超える場合エラー表記になる', () => {
		const result = run('/choice5 A B C');
		assert.match(result, /\$\[bg\.color=ffb3b3 error: 不正な指定です\]/);
	});

	test('選択数 0 はエラー表記になる', () => {
		const result = run('/choice0 A B C');
		assert.match(result, /\$\[bg\.color=ffb3b3 error: 不正な指定です\]/);
	});

	test('選択肢の区切りはカンマにも対応する', () => {
		const result = run('/choicex2 A,B,C');
		const m = result.match(/^\/choicex2 A,B,C = \(\$\[bg\.color=fff5a0 (.+)\]\)$/);
		assert.ok(m, `unexpected format: ${result}`);
		const picked = m![1].split(', ');
		assert.strictEqual(picked.length, 2);
		for (const p of picked) {
			assert.ok(['A', 'B', 'C'].includes(p), `unexpected choice: ${p}`);
		}
	});

	test('choicex と choice が同一本文に混在しても独立して展開される', () => {
		const result = run('/choicex2 A B\n/choice1 X Y Z');
		const lines = result.split('\n');
		assert.match(lines[0], /^\/choicex2 A B = \(\$\[bg\.color=fff5a0 .+\]\)$/);
		assert.match(lines[1], /^\/choice1 X Y Z = \(\$\[bg\.color=fff5a0 .+\]\)$/);
	});

	test('コマンドを含まない通常テキストは変化しない', () => {
		assert.strictEqual(run('こんにちは、世界'), 'こんにちは、世界');
	});

	test('remainingBudget が 0 の場合は展開しない', () => {
		const result = run('/choice1 A B', 0);
		assert.strictEqual(result, '/choice1 A B');
	});
});
