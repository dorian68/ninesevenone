import { spawn } from "node:child_process";
import { resolve } from "node:path";

const port = process.env.CARAAIOS_MCP_PORT || "3100";
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("CARAAIOS_MCP_PORT must be a valid TCP port.");
}
if (!process.env.CARAAIOS_MCP_TOKEN || process.env.CARAAIOS_MCP_TOKEN.length < 32) {
  throw new Error("Set CARAAIOS_MCP_TOKEN to a random secret of at least 32 characters before starting MCP.");
}
const nextCli = resolve("node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", port], {
  cwd: resolve("apps", "web"), env: process.env, stdio: "inherit", windowsHide: true
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => { process.exitCode = code ?? 1; });
