import type { Knex } from "knex";

/**
 * 0003 —— o_video.time 列由 integer 改为 bigInteger
 *
 * 背景：o_video.time 存的是 Date.now() 毫秒时间戳（约 1.7e12），
 * 但 0001_init 误将其定义为 integer(int4，上限约 2.1e9)，
 * PG 下 insert 会报 "value ... is out of range for type integer"。
 * 其它时间戳列（createTime/updateTime/startTime）均已是 bigInteger，此列为漏网。
 *
 * int4 → int8 是无损扩大转换，PG 可直接 ALTER。
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("o_video", (t) => {
    t.bigInteger("time").alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("o_video", (t) => {
    t.integer("time").alter();
  });
}
