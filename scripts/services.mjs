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
  ["judge", 3007], // Python/FastAPI — startOne() spawn riêng qua `uv run uvicorn`, xem nhánh JUDGE bên dưới.
  ["ai", 3008],
  ["realtime", 3009],
  // 3010/3011 là apps/lecturer và apps/admin bên frontend, nên dải backend nhảy qua.
  ["notification", 3012],
  ["recommendation", 3013],
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

// Judge là Python/FastAPI, bị loại khỏi `nest-cli.json`/`build:all` (xem judge-service/README).
// Nó KHÔNG có `dist/apps/judge-service` — trước đây `startOne` vẫn tìm đường Nest chung, và
// một bản build Nest bỏ sót từ trước lần migrate vẫn nằm đó thì nó cứ khởi động nhầm bản đó
// (UnknownDependenciesException, vì bản dist đó cũ hơn cả `MessagingModule` hiện tại). Tách
// hẳn nhánh riêng để không bao giờ còn phụ thuộc vào một thư mục dist có tồn tại hay không.
function judgeCommand() {
  const cwd = join(repoRoot, "apps", "judge-service");
  return isWindows
    ? { cmd: "cmd.exe", args: ["/c", "uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3007"], cwd }
    : { cmd: "uv", args: ["run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3007"], cwd };
}

async function startOne(name, port) {
  if (pidOnPort(port)) {
    console.log(`  ${name.padEnd(12)} đang chạy sẵn ở :${port} — bỏ qua`);
    return true;
  }

  let command;
  if (name === "judge") {
    command = judgeCommand();
  } else {
    const entry = join(repoRoot, "dist", "apps", `${name}-service`, "apps", `${name}-service`, "src", "main.js");
    if (!existsSync(entry)) {
      console.log(`  ${name.padEnd(12)} CHƯA BUILD (${entry})`);
      return false;
    }
    command = { cmd: "node", args: [entry], cwd: repoRoot };
  }

  mkdirSync(logDir, { recursive: true });
  const out = openSync(join(logDir, `${name}.log`), "w");
  const err = openSync(join(logDir, `${name}.log`), "a");
  const child = spawn(command.cmd, command.args, {
    cwd: command.cwd,
    detached: true,
    stdio: ["ignore", out, err],
  });
  child.unref();

  // Judge chờ lâu hơn: `uv run` tạo venv lần đầu, và consumer Kafka phải join group +
  // được gán partition trước khi app coi là "đã lên" — đo thực tế mất khoảng 30s, ngay
  // sát ngưỡng 30s chung, nên dễ báo lỗi giả dù service rồi cũng lên được.
  const bound = await waitUntil(() => pidOnPort(port), name === "judge" ? 180 : 60, 500);
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
