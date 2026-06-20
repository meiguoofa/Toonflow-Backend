import type { Knex } from "knex";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config();

const config: Knex.Config = {
  client: "pg",
  connection: {
    host: process.env.PG_HOST,
    port: process.env.PG_PORT ? Number(process.env.PG_PORT) : 5432,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
  },
  pool: { min: 0, max: 10 },
  migrations: {
    directory: path.join(__dirname, "migrations"),
    extension: "ts",
    tableName: "knex_migrations",
  },
  seeds: {
    directory: path.join(__dirname, "seeds"),
    extension: "ts",
  },
};

export default config;
