import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = platform() === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const children = new Map();

function start(name, cwd) {
  console.log(`[dev] Starting ${name} in ${cwd}`);
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd,
    stdio: "inherit",
    shell: isWindows,
    windowsHide: true,
  });
  children.set(name, child);
  child.on("error", error => {
    console.error(`[dev] Failed to start ${name}:`, error);
    stopAll(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[dev] ${name} exited (code=${code}, signal=${signal ?? "none"}).`);
    stopAll(code && code !== 0 ? code : 1);
  });
}

let stopping = false;

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (isWindows && child.pid) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) stopChild(child);
  process.exitCode = code;
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

start("SERVER", path.join(root, "server"));
start("CLIENT", path.join(root, "client"));
