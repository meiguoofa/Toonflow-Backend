import type { Knex } from "knex";

/**
 * 0002 —— 给 o_assets2Storyboard 增加自增序列列 seq
 *
 * 背景：桌面端原 SQLite 用隐藏列 rowid 表示插入顺序，按 rowid 排序拿到
 * 「分镜关联资产的添加顺序」。PostgreSQL 没有 rowid，迁移后 orderBy("rowid") 报错。
 * o_assets2Storyboard 是复合主键 (storyboardId, assetId)，无 id/时间戳列，
 * 无法复刻插入顺序，故新增 bigserial 自增列 seq 专门保留插入顺序。
 *
 * 新增列时 PG 会按现有行的物理顺序依次赋 seq 值（近似原插入顺序），完成回填。
 * 桌面端 insert 不传 seq，由 PG default nextval 自动递增。
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("o_assets2Storyboard", (t) => {
    t.bigIncrements("seq", { primaryKey: false });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("o_assets2Storyboard", (t) => {
    t.dropColumn("seq");
  });
}
