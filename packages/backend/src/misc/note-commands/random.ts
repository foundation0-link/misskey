/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as crypto from 'node:crypto';

// [1, max] の一様乱数(ダイス目)
export function rollDie(max: number): number {
	return crypto.randomInt(1, max + 1);
}

// [0, length) の一様乱数(配列インデックス選択用)
export function pickIndex(length: number): number {
	return crypto.randomInt(0, length);
}
