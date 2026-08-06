# ノート本文ダイス・チョイスコマンド 設計書

## 目的

ノート投稿時にサーバ側で本文中の特定コマンド文字列(`/dice2d6` 等)を検出し、乱数による結果へ展開する機能を実装する。TRPG や雑談用途での利用を想定する。

## 対象範囲

ローカルユーザによる新規ノート投稿(`notes/create` エンドポイント)のみを対象とする。ノート編集、リモートから連合で受信したノート、その他の投稿経路(Webhook 経由投稿等)は対象外とする。

## 対応コマンド

| コマンド | 意味 | 出力形式 |
|---|---|---|
| `/dice{N}d{S}` | N個のS面ダイスを振り合計を出す | `$[bg.color=fff5a0 合計]` |
| `/dice{N}b{S}` | N個のS面ダイスをバラ目で出す | `$[bg.color=fff5a0 目1, 目2, ... (合計)]` |
| `/dd` | `/dice1d100` の別名(クイックダイス) | `$[bg.color=fff5a0 出目]` |
| `/choice{N} 選択肢...` / `/cc{N} 選択肢...` | 選択肢からN件を重複なしで選ぶ | `$[bg.color=fff5a0 選択1, 選択2, ...]` |
| `/choicex{N} 選択肢...` / `/ccx{N} 選択肢...` | 選択肢からN件を重複ありで選ぶ | `$[bg.color=fff5a0 選択1, 選択2, ...]` |

いずれも行頭 (`^`, `/gm`) のみをマッチ対象とする。元のコマンド文字列(`/dice2d6` 等)はノート本文に残し、末尾に `= (展開結果)` を追記する形式とする。

エラー時は同じ MFM 背景色構文で、色を分けて表記する。

```
$[bg.color=ffb3b3 error: 不正な数値指定です]
```

成功表記の背景色は `fff5a0`、エラー表記の背景色は `ffb3b3` とする。

## 数値上限

| 項目 | 上限 | 理由 |
|---|---|---|
| `/dice{N}d{S}` のロール回数 N | 100 | 提示コードの制限を踏襲 |
| ダイス面数 S | 1,000,000 | 提示コードの制限を踏襲 |
| `/choice{N}` の選択数 N | 選択肢の総数まで(ユニーク版) | 重複なし抽選の性質上の制約 |
| `/choicex{N}` の抽選回数 N | 100 | ダイスと同水準の上限を新設 |
| 1ノートあたりの総展開件数(全コマンド合計) | 30件 | DoS対策として新設。5種のコマンドを横断する共有カウンタで管理する |

31件目以降にマッチしたコマンド文字列は展開せず、原文のまま残す(エラー表記も付けない)。

## 本文長超過時の扱い

展開はノート全体で1回だけ最終判定する。全コマンドを展開し終えた文字列の長さが `MAX_NOTE_TEXT_LENGTH`(3000文字)を超える場合、展開結果を破棄し元の `text` をそのまま投稿する。個別コマンド単位での部分的な破棄は行わない。

## チョイス系の選択肢パース

選択肢の区切り文字は提示コードと同じ `[\s,]+` とする(選択肢自体に空白は含められない)。分割結果に含まれる空文字列要素は除去する。

## 適用順序

1. `choicex` / `ccx`(重複あり)
2. `choice` / `cc`(重複なし)
3. `dice{N}d{S}`
4. `dice{N}b{S}`
5. `dd`

長い名前のコマンドを先に処理し、短い名前のコマンドとの誤マッチを避ける。展開件数カウンタは5種のコマンドを通じて共有する。

## 配置

```
packages/backend/src/misc/note-commands/
├── types.ts   … Processor / NoteCommandContext インターフェース
├── random.ts  … crypto.randomInt ベースの乱数ユーティリティ
├── dice.ts    … ダイス系 processor(/dice{N}d{S} /dice{N}b{S} /dd)
├── choice.ts  … チョイス系 processor(/choicex /ccx /choice /cc)
└── index.ts   … processor 登録と applyNoteCommands エントリポイント
```

`packages/backend/src/misc/` は DI を要しない純粋関数群を置く層であり、`extract-hashtags.ts` 等と同じ性格を持つ。ダイス・チョイス展開は文字列から文字列への変換(乱数を除き副作用なし)であるため、この層に置く。

## 呼び出し位置

[notes/create.ts](../../../packages/backend/src/server/api/endpoints/notes/create.ts) の `text: ps.text ?? null` を、以下に置き換える。

```ts
text: applyNoteCommands(ps.text ?? null),
```

リモート由来の `ApNoteService` / `ApInboxService` は `NoteCreateService.create()` を直接呼び出すため、この変更の影響を受けない。ノート編集経路も対象外のままとなる。

## 型定義

```ts
export interface NoteCommandContext {
	remainingBudget: number; // 残り展開可能件数(初期値30、共有カウンタ)
}

export interface Processor {
	name: string;
	processor(body: string, ctx: NoteCommandContext): string;
}
```

提示コードの `processor(body: string): string` に対し、展開件数の共有カウンタを引き回すための第2引数 `ctx` を追加する。各 processor は1件展開するたびに `ctx.remainingBudget` を減算し、0以下になった時点でそれ以降のマッチを未展開のまま返す。

## エントリポイント実装方針

```ts
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
		return text; // 展開全体を破棄し原文へフォールバック
	}

	return body;
}
```

`dice.ts` は `/dice{N}d{S}` `/dice{N}b{S}` `/dd` の3正規表現をこの順で `body.replace` する1つの processor にまとめる。`choice.ts` は `choicex/ccx` → `choice/cc` の2正規表現を持つ1つの processor にまとめる(提示コードの構成を踏襲)。

## 乱数ユーティリティ

`Math.random()` 系の呼び出しを `crypto.randomInt()` に統一する共通関数を用意する。

```ts
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

`crypto.randomInt` の引数上限は `2^48 - 1` であり、ダイス面数の上限 1,000,000 を十分に超える。

## エラー処理方針

- 正規表現マッチ内の分岐で完結させ、例外は投げない(提示コードの方針を維持する)。
- `applyNoteCommands` 自体も例外を投げない設計とする。不正な入力はすべて処理中の分岐で吸収できるため、追加の try-catch は設けない。
- ノート投稿全体のエラーハンドリング(`notes/create.ts` の既存 catch)には影響を与えない。

## テスト方針

`packages/backend/test/unit/note-commands.ts` に配置し、`extract-mentions.ts` と同じ Mocha 単体テストの形式に合わせる。

検証項目:

1. `/dice2d6` が `合計 = (<MFM表記>)` 形式に展開され、値が2〜12の範囲に収まる
2. `/dice3b6` がバラ目3つと合計を含む形式に展開される
3. `/dd` が1〜100の範囲に展開される
4. ロール回数0・負数・101以上でエラー表記になる
5. ダイス面数0・負数・1,000,001以上でエラー表記になる
6. `/choice2 A B C` が重複なしで2件選ばれる
7. `/choicex3 A B` が重複ありで3件選ばれる(3件中に同じ値を許容する)
8. 選択数が選択肢総数を超える場合エラー表記になる
9. 複数行に同種・異種コマンドが混在した場合、すべて独立して展開される
10. 1ノート内に31件以上のコマンドがある場合、31件目以降は未展開のまま残る
11. 展開結果が3000文字を超える場合、原文がそのまま返る
12. コマンドを含まない通常テキストは変化しない
13. `text` が `null` の場合 `null` を返す

`crypto.randomInt` を使うため乱数の決定性がない。個々のテストは「値が期待レンジ内に収まること」「件数が正しいこと」を確認する形とする。決定的乱数へのモック差し替えは行わず、範囲検証で十分と判断する。

## 決定事項サマリー

| 項目 | 決定内容 |
|---|---|
| 出力表記 | MFM の `$[bg.color=...]` |
| 元コマンド文字列 | ノート本文に残す |
| 乱数源 | `crypto.randomInt()` |
| 適用範囲 | ローカルユーザの新規投稿のみ |
| 保存方針 | 展開済み本文を DB に保存(連合にも展開済み本文を配送) |
| 対象経路 | `notes/create` のみ(編集・リモート受信は対象外) |
| 本文長超過時 | 展開全体を破棄し原文を保持 |
| チョイス区切り文字 | 空白・カンマ(現行踏襲) |
| コマンド数上限 | 1ノートあたり合計30件 |
