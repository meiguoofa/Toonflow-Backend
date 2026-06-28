import type { Knex } from "knex";

/**
 * 0004 —— o_vendorConfig 加 template / name 列
 *
 * 背景：phase 2 引入"模板系统"，让用户添加自定义 vendor 时只需选模板（如 openai-compatible）+
 * 填参数，不再上传 TS 代码。后端 ai/index.ts 按 o_vendorConfig.template 选择对应适配器。
 * 同时给用户自定义 vendor 起个可读名（name 列），与 id（机器名）分离。
 *
 * 字段：
 *   - template TEXT：对应 src/ai/vendor/<template>.ts 的文件名。
 *     回填策略：现有 11 个内置 vendor 行 template = id（toonflow→toonflow，volcengine→volcengine 等）。
 *   - name TEXT：vendor 显示名（中文友好名）。回填为 NULL，后端读取时回退到 builtin-vendor-meta.json
 *     里的内置 name。
 *
 * 不动 userId / 主键 —— phase 2 暂不做多租户隔离改造，o_vendorConfig 仍是全局共享表。
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("o_vendorConfig", (t) => {
    t.text("template");
    t.text("name");
  });
  // 回填：把现有所有行的 template 设为自身 id（向后兼容旧行为）
  await knex("o_vendorConfig").update({ template: knex.ref("id") });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("o_vendorConfig", (t) => {
    t.dropColumn("name");
    t.dropColumn("template");
  });
}
