/**
 * 一次性脚本：把桌面端本地 data/oss 目录下的文件批量上传到 TOS。
 *
 * **骨架** —— 需要在持有真实 TOS 凭据 + 本地存量数据的运维环境实跑；
 * 当前仓库无 TOS 凭据可用，CI 不会执行。
 *
 * 运行：
 *   ts-node scripts/migrate-oss-to-tos.ts /path/to/local/data/oss
 *
 * 行为：
 *   1. 递归遍历 ROOT_DIR，跳过 `smallImage/` 子目录（旧本地缩略图缓存）。
 *   2. 对每个文件计算 TOS key = 相对 ROOT_DIR 的 posix 路径。
 *      与 DB 里 filePath 字段（去 `/oss/` 前缀）一致。
 *   3. PUT 到 TOS_BUCKET。已存在则跳过（HEAD 探测）。
 *   4. 把 (relPath, key, size) 追加写入 migration-report.csv，便于审计。
 *
 * **不会**修改任何 DB 字段——DB 里 `filePath` 字段去掉 `/oss/` 前缀的迁移
 * 由独立 SQL 脚本完成（建议 migrations/ 里写一条幂等 update）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { tosClient, TOS_BUCKET } from "../src/tos";

async function* walk(dir: string, base: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      // 跳过本地缩略图缓存
      if (path.relative(base, abs).startsWith("smallImage")) continue;
      yield* walk(abs, base);
    } else if (e.isFile()) {
      yield abs;
    }
  }
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await tosClient.headObject({ bucket: TOS_BUCKET, key });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: ts-node scripts/migrate-oss-to-tos.ts <local-oss-root>");
    process.exit(1);
  }

  const reportPath = path.join(process.cwd(), "migration-report.csv");
  const report = await fs.open(reportPath, "a");
  await report.write("relPath,key,size,status\n");

  let ok = 0, skipped = 0, failed = 0;
  for await (const abs of walk(root, root)) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const key = rel; // DB 里 filePath 形如 "/123/assets/xx.png"，去前导 / 即为 key
    try {
      if (await objectExists(key)) {
        skipped += 1;
        await report.write(`${rel},${key},,skip\n`);
        continue;
      }
      const buf = await fs.readFile(abs);
      await tosClient.putObject({ bucket: TOS_BUCKET, key, body: buf });
      ok += 1;
      await report.write(`${rel},${key},${buf.length},ok\n`);
    } catch (e: any) {
      failed += 1;
      await report.write(`${rel},${key},,fail:${(e?.message || e).toString().replace(/[\r\n,]/g, " ")}\n`);
      console.error("[migrate] failed:", rel, e?.message || e);
    }
  }
  await report.close();
  console.log(`[migrate] done. ok=${ok} skipped=${skipped} failed=${failed} report=${reportPath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[migrate] fatal:", e);
    process.exit(1);
  });
}
