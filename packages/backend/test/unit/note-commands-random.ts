/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'assert';
import { describe, test } from 'vitest';
import { rollDie, pickIndex } from '@/misc/note-commands/random.js';

describe('note-commands random', () => {
	test('rollDie は 1 から max までの範囲を返す', () => {
		for (let i = 0; i < 200; i++) {
			const v = rollDie(6);
			assert.ok(v >= 1 && v <= 6, `out of range: ${v}`);
		}
	});

	test('rollDie(1) は常に 1 を返す', () => {
		for (let i = 0; i < 20; i++) {
			assert.strictEqual(rollDie(1), 1);
		}
	});

	test('pickIndex は 0 から length-1 までの範囲を返す', () => {
		for (let i = 0; i < 200; i++) {
			const v = pickIndex(5);
			assert.ok(v >= 0 && v < 5, `out of range: ${v}`);
		}
	});

	test('pickIndex(1) は常に 0 を返す', () => {
		for (let i = 0; i < 20; i++) {
			assert.strictEqual(pickIndex(1), 0);
		}
	});
});
