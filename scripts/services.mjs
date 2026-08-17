#!/usr/bin/env node
// Chạy/dừng 9 service ở môi trường dev — bản Node, chạy được trên Windows lẫn Linux/Mac.
// Cổng vào duy nhất `npm run services` gọi tới; xem scripts/services.sh cho bản bash gốc
// (dùng khi có bash thật — WSL không cài distro thì không có bash, đây là lối đi khác).
//
//   node scripts/services.mjs start|stop|restart|status [tên-service...]
//
// Dừng theo PID đang giữ cổng, không theo tên tiến trình: khớp process name/cmdline
// dễ dính nhầm tiến trình khác đang chạy cùng máy.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = platform() === "win32";
const logDir = process.env.CODEMENTOR_LOG_DIR ?? join(repoRoot, ".logs");

const SERVICES = [
  ["core", 3001],
  ["learning", 3002],
  ["exercise", 3003],
  ["workspace", 3004],
  ["document", 3005],
  ["submission", 3006],
  ["judge", 3007], // Python, chạy qua docker compose — start_one sẽ báo "CHƯA BUILD" và bỏ qua, không chặn service khác.
  ["ai", 3008],
  ["realtime", 3009],
  // 3010/3011 là apps/lecturer và apps/admin bên frontend, nên dải backend nhảy qua.
  ["notification", 3012],
];

function pidOnPort(port) {
  try {
    if (isWindows) {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
      const re = new RegExp(`^\\s*TCP\\s+\\S*:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "m");
      return re.exec(out)?.[1] ?? null;
    }
    const out = execFileSync("ss", ["-lntp"], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (fields[3]?.endsWith(`:${port}`)) return /pid=(\d+)/.exec(line)?.[1] ?? null;
    }
    return null;
  } catch {
    return null; // Lệnh không có / không có quyền — coi như không biết ai giữ cổng.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, attempts, intervalMs) {
  for (let i = 0; i < attempts; i += 1) {
    const value = predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

function selected(names) {
  if (names.length === 0) return SERVICES;
  return names.map((want) => SERVICES.find(([name]) => name === want)).filter(Boolean);
}

function stopOne(name, port) {
  const pid = pidOnPort(port);
  if (!pid) {
    console.log(`  ${name.padEnd(12)} không chạy`);
    return;
  }
  try {
    if (isWindows) execFileSync("taskkill", ["/PID", pid, "/T", "/F"]);
    else process.kill(Number(pid), "SIGTERM");
  } catch {
    // Tiến trình đã biến mất giữa lúc đọc pid và lúc kill — không sao.
  }
  console.log(`  ${name.padEnd(12)} đã dừng (pid ${pid})`);
}

async function startOne(name, port) {
  const entry = join(repoRoot, "dist", "apps", `${name}-service`, "apps", `${name}-service`, "src", "main.js");

  if (pidOnPort(port)) {
    console.log(`  ${name.padEnd(12)} đang chạy sẵn ở :${port} — bỏ qua`);
    return true;
  }
  if (!existsSync(entry)) {
    console.log(`  ${name.padEnd(12)} CHƯA BUILD (${entry})`);
    return false;
  }

  mkdirSync(logDir, { recursive: true });
  const out = openSync(join(logDir, `${name}.log`), "w");
  const err = openSync(join(logDir, `${name}.log`), "a");
  const child = spawn("node", [entry], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", out, err],
  });
  child.unref();

  const bound = await waitUntil(() => pidOnPort(port), 60, 500);
  if (bound) {
    console.log(`  ${name.padEnd(12)} :${port}`);
    return true;
  }
  console.log(`  ${name.padEnd(12)} KHÔNG LÊN ĐƯỢC — xem ${join(logDir, `${name}.log`)}`);
  return false;
}

function statusOne(name, port) {
  const pid = pidOnPort(port);
  console.log(pid ? `  ${name.padEnd(12)} :${String(port).padEnd(6)} pid ${pid}` : `  ${name.padEnd(12)} :${String(port).padEnd(6)} dừng`);
}

const [action = "status", ...rest] = process.argv.slice(2);
const chosen = selected(rest);

let failed = false;
switch (action) {
  case "stop":
    for (const [name, port] of chosen) stopOne(name, port);
    break;
  case "start":
    for (const [name, port] of chosen) if (!(await startOne(name, port))) failed = true;
    break;
  case "restart":
    for (const [name, port] of chosen) stopOne(name, port);
    for (const [name, port] of chosen) if (!(await startOne(name, port))) failed = true;
    break;
  case "status":
    for (const [name, port] of chosen) statusOne(name, port);
    break;
  default:
    console.error("dùng: node scripts/services.mjs start|stop|restart|status [tên-service...]");
    process.exit(2);
}

process.exit(failed ? 1 : 0);
