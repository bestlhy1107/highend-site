#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_BACKUP_DIR = ".runtime-backups";

function parseArgs(argv) {
  const result = new Map();

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;

    const [key, ...valueParts] = arg.slice(2).split("=");
    result.set(key, valueParts.length ? valueParts.join("=") : "true");
  }

  return result;
}

async function listBackups(backupDir) {
  if (!existsSync(backupDir)) return [];

  const entries = await readdir(backupDir, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tar.gz")) continue;

    const archivePath = resolve(backupDir, entry.name);
    const archiveStat = await stat(archivePath);
    let manifest = null;

    try {
      manifest = JSON.parse(await readFile(`${archivePath}.json`, "utf8"));
    } catch {
      manifest = null;
    }

    backups.push({
      name: entry.name,
      archivePath,
      createdAt: manifest?.createdAt || new Date(archiveStat.mtimeMs).toISOString(),
      reason: manifest?.reason || "",
      bytes: archiveStat.size,
    });
  }

  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const args = parseArgs(process.argv.slice(2));
const backupDir = resolve(
  PROJECT_ROOT,
  String(args.get("dir") || process.env.RUNTIME_BACKUP_DIR || DEFAULT_BACKUP_DIR)
);
const backups = await listBackups(backupDir);

if (args.has("list")) {
  if (!backups.length) {
    console.log("暂无运行时数据备份。");
    process.exit(0);
  }

  for (const backup of backups) {
    console.log(`${backup.createdAt}  ${backup.name}  ${backup.reason}`.trim());
  }

  process.exit(0);
}

const requestedFile = args.get("file");
const archivePath = requestedFile
  ? resolve(PROJECT_ROOT, String(requestedFile))
  : backups[0]?.archivePath;

if (!archivePath || !existsSync(archivePath)) {
  console.error("未找到可恢复的备份文件。可先执行：npm run runtime:restore -- --list");
  process.exit(1);
}

if (!args.has("yes")) {
  console.error(
    [
      "恢复会覆盖当前 data/ 和 public/uploads/ 中的同名文件。",
      "请确认后追加 -- --yes，例如：",
      `npm run runtime:restore -- --file=${archivePath} --yes`,
    ].join("\n")
  );
  process.exit(1);
}

if (!args.has("skip-current-backup")) {
  const backup = spawnSync(
    process.execPath,
    [resolve(PROJECT_ROOT, "scripts/runtime-data-backup.mjs"), "--reason=pre-restore"],
    {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    }
  );

  if (backup.status !== 0) {
    console.error("恢复前备份当前运行时数据失败，已停止恢复。");
    process.exit(backup.status || 1);
  }
}

const tar = spawnSync("tar", ["-xzf", archivePath, "-C", PROJECT_ROOT], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
});

if (tar.status !== 0) {
  console.error("运行时数据恢复失败。");
  process.exit(tar.status || 1);
}

console.log(`运行时数据已恢复：${archivePath}`);
