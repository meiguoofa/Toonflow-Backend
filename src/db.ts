import knexFactory from "knex";
import knexConfig from "../knexfile";

// 单例 Knex(pg) 实例。整个后端进程共用。
export const knex = knexFactory(knexConfig);

export default knex;
