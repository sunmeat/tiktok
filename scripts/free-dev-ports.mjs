import { execFileSync } from "node:child_process";
import { platform } from "node:os";

const ports = [3000, 5173];

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

if (platform() === "win32") {
  const output = run("netstat", ["-ano", "-p", "tcp"]);
  const pids = new Set();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (match && ports.includes(Number(match[1]))) pids.add(match[2]);
  }

  for (const pid of pids) {
    console.log(`[dev] Stopping process tree on port 3000/5173 (PID ${pid})...`);
    run("taskkill", ["/PID", pid, "/T", "/F"]);
  }
} else {
  for (const port of ports) {
    const output = run("lsof", ["-ti", `TCP:${port}`, "-sTCP:LISTEN"]);
    const pids = output.split(/\s+/).filter(Boolean);

    for (const pid of pids) {
      console.log(`[dev] Stopping process on port ${port} (PID ${pid})...`);
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        // The process may have exited between lookup and signal.
      }
    }
  }
}

console.log("[dev] Port cleanup complete.");
