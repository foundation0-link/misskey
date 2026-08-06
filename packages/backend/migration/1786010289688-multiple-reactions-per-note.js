/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class MultipleReactionsPerNote1786010289688 {
    name = 'MultipleReactionsPerNote1786010289688'

    async up(queryRunner) {
        // 同一ユーザーが同一ノートへ複数の異なるリアクションを付けられるようにするため、
        // 一意制約を (userId, noteId) から (userId, noteId, reaction) へ広げる
        await queryRunner.query(`DROP INDEX "public"."IDX_ad0c221b25672daf2df320a817"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7751b74317122d11575bff31c" ON "note_reaction" ("userId", "noteId", "reaction") `);
    }

    async down(queryRunner) {
        // 巻き戻し先の一意制約 (userId, noteId) は 1 ユーザー 1 リアクションしか許さないため、
        // up 適用後に増えた 2 件目以降のリアクションを削除してからでないとインデックスを再作成できない。
        // 各 (userId, noteId) について最も古い 1 件 (id 昇順の先頭) だけを残す。
        // 削除されたリアクションは復元できない。
        await queryRunner.query(`DELETE FROM "note_reaction" WHERE "id" NOT IN (SELECT MIN("id") FROM "note_reaction" GROUP BY "userId", "noteId")`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a7751b74317122d11575bff31c"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ad0c221b25672daf2df320a817" ON "note_reaction" ("userId", "noteId") `);
    }
}
