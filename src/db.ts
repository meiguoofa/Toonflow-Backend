import knexFactory from "knex";
import { types } from "pg";
import knexConfig from "../knexfile";

// node-postgres 默认把 int8(bigint, OID=20) 当字符串返回（避免 JS number 精度丢失），
// 导致前端拿到 string 类型的 id/projectId/createTime，zod z.number() 校验失败、比较出错。
// 本项目所有 bigInteger 值（id 为 Date.now() 级、时间戳同级，均 < Number.MAX_SAFE_INTEGER）
// 用 number 表示是安全的，故统一解析为 number；count() 等聚合的 int8 结果也一并转为 number。
types.setTypeParser(20, (val) => parseInt(val, 10));

// 单例 Knex(pg) 实例。整个后端进程共用。
export const knex = knexFactory(knexConfig);

export default knex;
