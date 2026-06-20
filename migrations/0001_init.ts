import type { Knex } from "knex";

/**
 * 0001_init —— 初始化 26 张表（PostgreSQL 版本）
 *
 * 来源：Toonflow-app/src/lib/initDB.ts （SQLite/better-sqlite3 schema）
 *
 * 关键适配决策（详见 README.md 与 docs/db-proxy-protocol.md）：
 * 1. 主键保持 BIGINT/TEXT，不使用 GENERATED IDENTITY —— 桌面端代码自行分配 id（雪花/uuid/自增），保持兼容
 * 2. 时间戳字段保持 BIGINT（毫秒），不改 timestamptz —— 与现有桌面端代码一致
 * 3. 大型 JSON 字段保持 TEXT —— 桌面端通过 JSON.stringify/parse 操作，pg jsonb 会破坏字符串语义
 * 4. boolean 字段使用 pg boolean
 * 5. 业务表统一加 userId BIGINT NOT NULL DEFAULT 1 + 单列索引（多租户铺垫）
 * 6. 配置/全局表（o_user/o_setting/o_vendorConfig/o_modelPrompt/o_skillList/o_skillAttribution/o_agentDeploy/o_prompt）不加 userId
 */

// 17 张需要 userId 的业务表
const BUSINESS_TABLES_WITH_USER_ID = [
  "o_novel",
  "o_event",
  "o_eventChapter",
  "o_script",
  "o_scriptAssets",
  "o_assets",
  "o_image",
  "o_storyboard",
  "o_assets2Storyboard",
  "o_video",
  "o_videoTrack",
  "o_imageFlow",
  "o_tasks",
  "o_agentWorkData",
  "o_assetsRole2Audio",
  "memories",
  "o_artStyle",
];

const addUserId = (table: Knex.CreateTableBuilder, tableName: string) => {
  if (BUSINESS_TABLES_WITH_USER_ID.includes(tableName)) {
    table.bigInteger("userId").notNullable().defaultTo(1);
    table.index(["userId"], `idx_${tableName}_userId`);
  }
};

type T = Knex.CreateTableBuilder;

export async function up(knex: Knex): Promise<void> {
  // ===== 用户表 =====
  await knex.schema.createTable("o_user", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("name");
    table.text("password");
  });

  // ===== 项目表（已有 userId，保留） =====
  await knex.schema.createTable("o_project", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("projectType");
    table.text("imageModel");
    table.text("imageQuality");
    table.text("videoModel");
    table.text("name");
    table.text("intro");
    table.text("type");
    table.text("artStyle");
    table.text("directorManual");
    table.text("mode");
    table.text("videoRatio");
    table.bigInteger("createTime");
    table.bigInteger("userId");
    table.index(["userId"], "idx_o_project_userId");
  });

  // ===== 风格表 =====
  await knex.schema.createTable("o_artStyle", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("name");
    table.text("fileUrl");
    table.text("label");
    table.text("prompt");
    addUserId(table, "o_artStyle");
  });

  // ===== Agent 配置表 =====
  await knex.schema.createTable("o_agentDeploy", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("model");
    table.text("key");
    table.text("modelName");
    table.text("vendorId");
    table.text("desc");
    table.text("name");
    table.integer("temperature");
    table.integer("maxOutputTokens");
    table.boolean("disabled").defaultTo(false);
  });

  // ===== 设置表 =====
  await knex.schema.createTable("o_setting", (table: T) => {
    table.text("key").notNullable().primary();
    table.text("value");
  });

  // ===== 任务中心表 =====
  await knex.schema.createTable("o_tasks", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.bigInteger("projectId");
    table.text("taskClass");
    table.text("relatedObjects");
    table.text("model");
    table.text("describe");
    table.text("state");
    table.bigInteger("startTime");
    table.text("reason");
    addUserId(table, "o_tasks");
  });

  // ===== 提示词表 =====
  await knex.schema.createTable("o_prompt", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("name");
    table.text("type");
    table.text("data");
    table.text("useData");
  });

  // ===== 模型绑定提示词表 =====
  await knex.schema.createTable("o_modelPrompt", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("vendorId");
    table.text("model");
    table.text("fileName");
    table.text("path");
    table.text("prompt");
  });

  // ===== 小说原文表 =====
  await knex.schema.createTable("o_novel", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.integer("chapterIndex");
    table.text("reel");
    table.text("chapter");
    table.text("chapterData");
    table.bigInteger("projectId");
    table.integer("eventState");
    table.text("event");
    table.text("errorReason");
    table.bigInteger("createTime");
    addUserId(table, "o_novel");
  });

  // ===== 小说事件表 =====
  await knex.schema.createTable("o_event", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("name");
    table.text("detail");
    table.bigInteger("createTime");
    addUserId(table, "o_event");
  });

  // ===== 事件-章节表 =====
  await knex.schema.createTable("o_eventChapter", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.bigInteger("eventId").references("id").inTable("o_event");
    table.bigInteger("novelId").references("id").inTable("o_novel");
    addUserId(table, "o_eventChapter");
  });

  // ===== 剧本 =====
  await knex.schema.createTable("o_script", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("name");
    table.text("content");
    table.bigInteger("projectId");
    table.integer("extractState");
    table.bigInteger("createTime");
    table.text("errorReason");
    addUserId(table, "o_script");
  });

  // ===== 生成图片表（先建，o_assets 引用它） =====
  await knex.schema.createTable("o_image", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("filePath");
    table.text("type");
    table.bigInteger("assetsId");
    table.text("model");
    table.text("resolution");
    table.text("state");
    table.text("errorReason");
    addUserId(table, "o_image");
  });

  // ===== 资产表 =====
  await knex.schema.createTable("o_assets", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("name");
    table.text("prompt");
    table.text("remark");
    table.text("type");
    table.text("describe");
    table.bigInteger("scriptId");
    table.bigInteger("imageId").references("id").inTable("o_image");
    table.bigInteger("assetsId");
    table.bigInteger("projectId");
    table.bigInteger("flowId");
    table.bigInteger("startTime");
    table.text("promptState");
    table.integer("audioBindState");
    table.text("promptErrorReason");
    addUserId(table, "o_assets");
  });

  // ===== 分镜 =====
  await knex.schema.createTable("o_storyboard", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.bigInteger("scriptId");
    table.text("prompt");
    table.text("filePath");
    table.text("duration");
    table.text("state");
    table.bigInteger("trackId");
    table.text("reason");
    table.text("track");
    table.text("videoDesc");
    table.integer("shouldGenerateImage"); // 0 否 1 是
    table.bigInteger("projectId");
    table.bigInteger("flowId");
    table.integer("index");
    table.bigInteger("createTime");
    addUserId(table, "o_storyboard");
  });

  // ===== Agent 工作流数据 =====
  await knex.schema.createTable("o_agentWorkData", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.bigInteger("projectId");
    table.bigInteger("episodesId");
    table.text("key");
    table.text("data");
    table.bigInteger("createTime");
    table.bigInteger("updateTime");
    addUserId(table, "o_agentWorkData");
  });

  // ===== 视频 =====
  await knex.schema.createTable("o_video", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("filePath");
    table.text("errorReason");
    table.integer("time");
    table.text("state");
    table.bigInteger("scriptId");
    table.bigInteger("projectId");
    table.bigInteger("videoTrackId");
    addUserId(table, "o_video");
  });

  // ===== 视频轨道 =====
  await knex.schema.createTable("o_videoTrack", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.bigInteger("videoId");
    table.bigInteger("projectId");
    table.bigInteger("scriptId");
    table.text("state");
    table.text("reason");
    table.text("prompt");
    table.bigInteger("selectVideoId");
    table.integer("duration");
    addUserId(table, "o_videoTrack");
  });

  // ===== 供应商配置表 =====
  await knex.schema.createTable("o_vendorConfig", (table: T) => {
    table.text("id").notNullable().primary();
    table.text("inputValues"); // JSON
    table.text("models"); // JSON
    table.integer("enable");
  });

  // ===== 图片工作流表 =====
  await knex.schema.createTable("o_imageFlow", (table: T) => {
    table.bigInteger("id").notNullable().primary();
    table.text("flowData").notNullable(); // JSON
    addUserId(table, "o_imageFlow");
  });

  // ===== 资产-分镜关联表 =====
  await knex.schema.createTable("o_assets2Storyboard", (table: T) => {
    table.bigInteger("storyboardId").notNullable();
    table.bigInteger("assetId").notNullable();
    table.primary(["storyboardId", "assetId"]);
    addUserId(table, "o_assets2Storyboard");
  });

  // ===== 剧本-资产关联表 =====
  await knex.schema.createTable("o_scriptAssets", (table: T) => {
    table.bigInteger("scriptId").notNullable();
    table.bigInteger("assetId").notNullable();
    table.primary(["scriptId", "assetId"]);
    addUserId(table, "o_scriptAssets");
  });

  // ===== Skill 列表 =====
  await knex.schema.createTable("o_skillList", (table: T) => {
    table.text("id").notNullable().primary();
    table.text("md5").notNullable();
    table.text("path").notNullable();
    table.text("name").notNullable();
    table.text("description").notNullable();
    table.text("embedding"); // JSON 向量
    table.text("type").notNullable();
    table.bigInteger("createTime").notNullable();
    table.bigInteger("updateTime").notNullable();
    table.integer("state").notNullable();
  });

  // ===== Skill 归属 =====
  await knex.schema.createTable("o_skillAttribution", (table: T) => {
    table.text("skillId").notNullable().references("id").inTable("o_skillList").onDelete("CASCADE");
    table.text("attribution").notNullable();
    table.primary(["skillId", "attribution"]);
    table.index(["attribution"]);
  });

  // ===== 记忆表 =====
  await knex.schema.createTable("memories", (table: T) => {
    table.text("id").notNullable().primary();
    table.text("isolationKey").notNullable();
    table.text("type").notNullable();
    table.text("role");
    table.text("name");
    table.text("content").notNullable();
    table.text("embedding"); // JSON
    table.text("relatedMessageIds"); // JSON
    table.integer("summarized").defaultTo(0);
    table.bigInteger("createTime").notNullable();
    table.index(["isolationKey", "type"]);
    table.index(["isolationKey", "summarized"]);
    addUserId(table, "memories");
  });

  // ===== 角色-音频关联表 =====
  await knex.schema.createTable("o_assetsRole2Audio", (table: T) => {
    table.bigInteger("assetsRoleId").notNullable();
    table.bigInteger("assetsAudioId").notNullable();
    table.primary(["assetsAudioId", "assetsRoleId"]);
    addUserId(table, "o_assetsRole2Audio");
  });
}

export async function down(knex: Knex): Promise<void> {
  // 反向顺序删除（外键约束）
  await knex.schema.dropTableIfExists("o_assetsRole2Audio");
  await knex.schema.dropTableIfExists("memories");
  await knex.schema.dropTableIfExists("o_skillAttribution");
  await knex.schema.dropTableIfExists("o_skillList");
  await knex.schema.dropTableIfExists("o_scriptAssets");
  await knex.schema.dropTableIfExists("o_assets2Storyboard");
  await knex.schema.dropTableIfExists("o_imageFlow");
  await knex.schema.dropTableIfExists("o_vendorConfig");
  await knex.schema.dropTableIfExists("o_videoTrack");
  await knex.schema.dropTableIfExists("o_video");
  await knex.schema.dropTableIfExists("o_agentWorkData");
  await knex.schema.dropTableIfExists("o_storyboard");
  await knex.schema.dropTableIfExists("o_assets");
  await knex.schema.dropTableIfExists("o_image");
  await knex.schema.dropTableIfExists("o_script");
  await knex.schema.dropTableIfExists("o_eventChapter");
  await knex.schema.dropTableIfExists("o_event");
  await knex.schema.dropTableIfExists("o_novel");
  await knex.schema.dropTableIfExists("o_modelPrompt");
  await knex.schema.dropTableIfExists("o_prompt");
  await knex.schema.dropTableIfExists("o_tasks");
  await knex.schema.dropTableIfExists("o_setting");
  await knex.schema.dropTableIfExists("o_agentDeploy");
  await knex.schema.dropTableIfExists("o_artStyle");
  await knex.schema.dropTableIfExists("o_project");
  await knex.schema.dropTableIfExists("o_user");
}
