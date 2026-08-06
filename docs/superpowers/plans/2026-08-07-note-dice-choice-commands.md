# ノートダイス・チョイスコマンド実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ノート投稿時 (`notes/create`) にサーバ側で本文中のダイス・チョイスコマンド文字列を検出し、乱数結果へ展開する。

**Architecture:** `packages/backend/src/misc/note-commands/` に DI 不要な純粋関数群を新設する。5種のコマンド (`/dice{N}d{S}` `/dice{N}b{S}` `/dd` `/choice{N}` `/choicex{N}`) をそれぞれ正規表現で検出し、MFM の `$[bg.color=...]` 構文へ置換するエントリポイント `applyNoteCommands()` を提供する。`notes/create.ts` の `text` 引き渡し箇所1行のみを変更し、リモート受信・ノート編集経路には影響を与えない。

**Tech Stack:** TypeScript, Node.js `node:crypto` (`crypto.randomInt`), Vitest (unit test)。

## Global Constraints

- 出力表記は MFM の `$[bg.color=...]` を使う。成功時背景色 `fff5a0`、エラー時背景色 `ffb3b3`。
- 元のコマンド文字列はノート本文に残し、末尾に `= (展開結果)` を追記する。
- 乱数源は `crypto.randomInt()` のみを使う (`Math.random()` は使用しない)。
- 適用範囲はローカルユーザの `notes/create` のみ。ノート編集・リモート受信 (`ApNoteService` / `ApInboxService`) には適用しない。
- 展開済み本文を DB に保存し、そのまま連合配送する (原文を別カラムに保持しない)。
- `/dice{N}d{S}` のロール回数上限は 100、ダイス面数上限は 1,000,000 (提示コード踏襲)。
- `/choicex{N}` の抽選回数上限は 100。`/choice{N}` の選択数上限は渡された選択肢の総数。
- 1ノートあたりの総展開件数上限は 30 件 (5種のコマンドで共有するカウンタ)。上限超過分は展開せず原文のまま残し、エラー表記は付けない。
- チョイス系の選択肢区切り文字は `[\s,]+` (空白・カンマ)。分割結果の空文字列要素は除去する。
- 展開後の本文長が `MAX_NOTE_TEXT_LENGTH` (3000文字、`@/const.js`) を超える場合、展開結果全体を破棄し元の `text` をそのまま使う。
- コマンド処理順序: `choicex/ccx` → `choice/cc` → `dice{N}d{S}` → `dice{N}b{S}` → `dd`。
- 新規 `.ts` ファイルには SPDX ヘッダーを付与する (`node scripts/check-spdx.mjs --fix` で補える)。

---

### Task 1: 型定義と乱数ユーティリティ

**Files:**
- Create: `packages/backend/src/misc/note-commands/types.ts`
- Create: `packages/backend/src/misc/note-commands/random.ts`
- Test: `packages/backend/test/unit/note-commands-random.ts`

**Interfaces:**
- Produces:
  - `interface NoteCommandContext { remainingBudget: number }`
  - `interface Processor { name: string; processor(body: string, ctx: NoteCommandContext): string }`
  - `function rollDie(max: number): number` — `[1, max]` の一様乱数
  - `function pickIndex(length: number): number` — `[0, length)` の一様乱数

- [ ] **Step 1: 失敗するテストを書く**

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter backend test test/unit/note-commands-random.ts`
Expected: FAIL (`Cannot find module '@/misc/note-commands/random.js'`)

- [ ] **Step 3: 型定義を実装する**

```ts
// packages/backend/src/misc/note-commands/types.ts
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
```

```ts
// packages/backend/src/misc/note-commands/random.ts
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter backend test test/unit/note-commands-random.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/backend/src/misc/note-commands/types.ts packages/backend/src/misc/note-commands/random.ts packages/backend/test/unit/note-commands-random.ts
git commit -m "add: note-commands の型定義と乱数ユーティリティを追加"
```

---

### Task 2: ダイス系 processor (`/dice{N}d{S}` `/dice{N}b{S}` `/dd`)

**Files:**
- Create: `packages/backend/src/misc/note-commands/dice.ts`
- Test: `packages/backend/test/unit/note-commands-dice.ts`

**Interfaces:**
- Consumes: `NoteCommandContext`, `Processor` (Task 1 の `types.ts`), `rollDie` (Task 1 の `random.ts`)
- Produces: `diceCommandsProcessor: Processor` (`name: 'diceCommands'`)

- [ ] **Step 1: 失敗するテストを書く**

```ts
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
		const m = result.match(/^\/dice2d6 = \(\$\[bg\.color=fff5a0 (\d+)\]\)$/);
		assert.ok(m, `unexpected format: ${result}`);
		const total = Number(m![1]);
		assert.ok(total >= 2 && total <= 12, `out of range: ${total}`);
	});

	test('/dice3b6 はバラ目と合計を MFM で埋め込む', () => {
		const result = run('/dice3b6');
		const m = result.match(/^\/dice3b6 = \(\$\[bg\.color=fff5a0 (\d+), (\d+), (\d+) \((\d+)\)\]\)$/);
		assert.ok(m, `unexpected format: ${result}`);
		const [r1, r2, r3, total] = m!.slice(1).map(Number);
		for (const r of [r1, r2, r3]) {
			assert.ok(r >= 1 && r <= 6, `out of range: ${r}`);
		}
		assert.strictEqual(r1 + r2 + r3, total);
	});

	test('/dd は 1〜100 の範囲に展開される', () => {
		const result = run('/dd');
		const m = result.match(/^\/dd = \(\$\[bg\.color=fff5a0 (\d+)\]\)$/);
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
		assert.match(lines[0], /^\/dice1d6 = \(\$\[bg\.color=fff5a0 \d+\]\)$/);
		assert.match(lines[1], /^\/dice1d20 = \(\$\[bg\.color=fff5a0 \d+\]\)$/);
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
		assert.match(lines[0], /\$\[bg\.color=fff5a0 \d+\]/);
		assert.strictEqual(lines[1], '/dice1d6');
	});
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter backend test test/unit/note-commands-dice.ts`
Expected: FAIL (`Cannot find module '@/misc/note-commands/dice.js'`)

- [ ] **Step 3: ダイス系 processor を実装する**

```ts
/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { rollDie } from './random.js';
import type { NoteCommandContext, Processor } from './types.js';

const SUCCESS_COLOR = 'fff5a0';
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter backend test test/unit/note-commands-dice.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/backend/src/misc/note-commands/dice.ts packages/backend/test/unit/note-commands-dice.ts
git commit -m "add: ダイス系ノートコマンド processor を追加"
```

---

### Task 3: チョイス系 processor (`/choice{N}` `/choicex{N}`)

**Files:**
- Create: `packages/backend/src/misc/note-commands/choice.ts`
- Test: `packages/backend/test/unit/note-commands-choice.ts`

**Interfaces:**
- Consumes: `NoteCommandContext`, `Processor` (Task 1 の `types.ts`), `pickIndex` (Task 1 の `random.ts`)
- Produces: `choiceCommandsProcessor: Processor` (`name: 'choiceCommands'`)

- [ ] **Step 1: 失敗するテストを書く**

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter backend test test/unit/note-commands-choice.ts`
Expected: FAIL (`Cannot find module '@/misc/note-commands/choice.js'`)

- [ ] **Step 3: チョイス系 processor を実装する**

```ts
/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { pickIndex } from './random.js';
import type { NoteCommandContext, Processor } from './types.js';

const SUCCESS_COLOR = 'fff5a0';
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter backend test test/unit/note-commands-choice.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/backend/src/misc/note-commands/choice.ts packages/backend/test/unit/note-commands-choice.ts
git commit -m "add: チョイス系ノートコマンド processor を追加"
```

---

### Task 4: エントリポイント `applyNoteCommands`

**Files:**
- Create: `packages/backend/src/misc/note-commands/index.ts`
- Test: `packages/backend/test/unit/note-commands.ts`

**Interfaces:**
- Consumes:
  - `choiceCommandsProcessor` (Task 3, `choice.ts` の default export)
  - `diceCommandsProcessor` (Task 2, `dice.ts` の default export)
  - `NoteCommandContext` (Task 1, `types.ts`)
  - `MAX_NOTE_TEXT_LENGTH` (`@/const.js`、既存定数、値 3000)
- Produces: `function applyNoteCommands(text: string | null): string | null`

- [ ] **Step 1: 失敗するテストを書く**

```ts
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
		// 選択肢を大量に並べて展開後に3000文字を超えさせる
		const longChoices = Array.from({ length: 200 }, (_, i) => `選択肢その${i}`).join(' ');
		const original = `/choice1 ${longChoices}`;
		const result = applyNoteCommands(original);
		assert.strictEqual(result, original);
	});
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter backend test test/unit/note-commands.ts`
Expected: FAIL (`Cannot find module '@/misc/note-commands/index.js'`)

- [ ] **Step 3: エントリポイントを実装する**

```ts
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter backend test test/unit/note-commands.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/backend/src/misc/note-commands/index.ts packages/backend/test/unit/note-commands.ts
git commit -m "add: ノートコマンド展開のエントリポイントを追加"
```

---

### Task 5: `notes/create` エンドポイントへの結線

**Files:**
- Modify: `packages/backend/src/server/api/endpoints/notes/create.ts:9`(import 追加)
- Modify: `packages/backend/src/server/api/endpoints/notes/create.ts:232`(`text` 引き渡し変更)
- Test: `packages/backend/test/e2e/note.ts`(既存ファイルに追加)

**Interfaces:**
- Consumes: `applyNoteCommands` (Task 4, `@/misc/note-commands/index.js`)

- [ ] **Step 1: 失敗する e2e テストを書く**

[test/e2e/note.ts](../../../../packages/backend/test/e2e/note.ts) の `describe('Note', ...)` ブロック内(既存の `test('投稿できる', ...)` 等が並ぶ箇所)に以下を追加する。

```ts
test('ダイスコマンドが展開されて投稿される', async () => {
	const note = await post(alice, { text: '/dice1d6' });
	assert.match(note.text ?? '', /^\/dice1d6 = \(\$\[bg\.color=fff5a0 \d+\]\)$/);
});

test('ダイスコマンドを含まないテキストは変化しない', async () => {
	const note = await post(alice, { text: 'ただの投稿です' });
	assert.strictEqual(note.text, 'ただの投稿です');
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm --filter backend test:e2e -- -t "ダイスコマンドが展開されて投稿される"`
Expected: FAIL (`note.text` が `/dice1d6` のまま、展開後の形式にマッチしない)

- [ ] **Step 3: `notes/create.ts` を修正する**

[packages/backend/src/server/api/endpoints/notes/create.ts:9](../../../../packages/backend/src/server/api/endpoints/notes/create.ts#L9) の import 群に以下を追加する。

```ts
import { applyNoteCommands } from '@/misc/note-commands/index.js';
```

[packages/backend/src/server/api/endpoints/notes/create.ts:232](../../../../packages/backend/src/server/api/endpoints/notes/create.ts#L232) の該当行を変更する。

変更前:
```ts
					text: ps.text ?? null,
```

変更後:
```ts
					text: applyNoteCommands(ps.text ?? null),
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm --filter backend test:e2e -- -t "ダイスコマンド"`
Expected: PASS (2件とも)

- [ ] **Step 5: コミット**

```bash
git add packages/backend/src/server/api/endpoints/notes/create.ts packages/backend/test/e2e/note.ts
git commit -m "add: notes/create でノートコマンド展開を有効化"
```

---

### Task 6: 最終検証と出荷チェック

**Files:** なし(検証のみ)

**Interfaces:** なし

- [ ] **Step 1: SPDX ヘッダーを検査する**

Run: `node scripts/check-spdx.mjs`
Expected: `SPDX: OK` (Task 1〜5 で作成した全ファイルにヘッダー付与済みのはず)

- [ ] **Step 2: 変更ファイルに対して ESLint を実行する**

Run:
```bash
pnpm --filter backend eslint --quiet \
	src/misc/note-commands/types.ts \
	src/misc/note-commands/random.ts \
	src/misc/note-commands/dice.ts \
	src/misc/note-commands/choice.ts \
	src/misc/note-commands/index.ts \
	src/server/api/endpoints/notes/create.ts \
	test/unit/note-commands-random.ts \
	test/unit/note-commands-dice.ts \
	test/unit/note-commands-choice.ts \
	test/unit/note-commands.ts
```
Expected: エラー0件

- [ ] **Step 3: unit テスト一式を実行する**

Run: `pnpm --filter backend test`
Expected: 全件 PASS (Task 1〜4 で追加した4ファイルを含む)

- [ ] **Step 4: e2e テスト (Note カテゴリ) を実行する**

Run: `pnpm --filter backend test:e2e -- -t "Note"`
Expected: 全件 PASS (Task 5 で追加した2件を含む)

- [ ] **Step 5: locale 変更有無を確認する**

Run: `git status --short locales/`
Expected: 出力なし(本機能は `locales/ja-JP.yml` を変更しない)

- [ ] **Step 6: misskey-js 再生成の要否を確認する**

本タスクは既存 endpoint `notes/create` の入出力スキーマ(`meta` / `paramDef` / `res`)を変更していないため、`pnpm build-misskey-js-with-types` の実行は不要。念のため差分なしを確認する。

Run: `git status --short packages/misskey-js/src/autogen/`
Expected: 出力なし

- [ ] **Step 7: 全体差分を最終確認する**

Run: `git log --oneline -6` と `git diff develop --stat`(または `git diff <作業開始コミット> --stat`)で、Task 1〜5 の6コミットと変更ファイル一覧が意図どおりであることを目視確認する。
