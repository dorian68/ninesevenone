#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const config = {
  host: process.env.DEPLOY_VPS_HOST ?? "root@204.168.138.243",
  sshKey: process.env.DEPLOY_SSH_KEY ?? resolve(homedir(), ".ssh", "rebondpro_deploy"),
  remoteDir: process.env.DEPLOY_REMOTE_DIR ?? "/opt/guad-enterprises",
  publicHost: process.env.DEPLOY_PUBLIC_HOST ?? "guad.204.168.138.243.sslip.io",
  publicUrl: process.env.DEPLOY_PUBLIC_URL ?? "https://guad.204.168.138.243.sslip.io",
  port: process.env.DEPLOY_LOCAL_PORT ?? "3002",
};

const args = process.argv.slice(2);
const execute = args.includes("--yes") || args.includes("--execute");
const allowDirty = args.includes("--allow-dirty");
const configureCaddy = args.includes("--configure-caddy");
const dryRun = !execute;
const color = { reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m" };
const log = (message) => console.log(message);
const step = (message) => log(`\n${color.cyan}▶ ${message}${color.reset}`);
const ok = (message) => log(`${color.green}✓${color.reset} ${message}`);
const fail = (message) => { console.error(`${color.red}✗ ${message}${color.reset}`); process.exit(1); };

function run(command, commandArgs, options = {}) {
  const printable = `${command} ${commandArgs.join(" ")}`;
  if (dryRun) {
    log(`[local] ${printable}`);
    return "";
  }
  const windowsScript = process.platform === "win32" && (command === "npm" || command === "npx");
  const result = spawnSync(windowsScript ? `${command}.cmd` : command, commandArgs, {
    shell: windowsScript,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0 && !options.allowFail) fail(`Commande échouée : ${printable}`);
  return options.capture ? (result.stdout || "").trim() : "";
}

const sshArgs = ["-i", config.sshKey, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new"];
function remote(command, options = {}) {
  if (dryRun) {
    log(`[vps] ${command}`);
    return "";
  }
  const result = spawnSync("ssh", [...sshArgs, config.host, command], {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0 && !options.allowFail) fail(`Commande VPS échouée : ${command}`);
  return options.capture ? (result.stdout || "").trim() : "";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function gitShort() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

async function publicHealthCheck() {
  if (dryRun) return true;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(config.publicUrl, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        ok(`URL publique accessible : ${config.publicUrl}`);
        return true;
      }
      log(`  tentative ${attempt}/12 : HTTP ${response.status}`);
    } catch (error) {
      log(`  tentative ${attempt}/12 : ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 4_000));
  }
  return false;
}

step("Préflight local");
if (!existsSync(config.sshKey) && !dryRun) fail(`Clé SSH introuvable : ${config.sshKey}`);
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty && !allowDirty) fail("Arbre Git non propre. Commitez d'abord ou utilisez --allow-dirty explicitement.");
run("npm", ["run", "typecheck"]);
run("npm", ["run", "test"]);
run("npm", ["run", "build"]);
ok("Contrôles locaux terminés");

const commit = dryRun ? "<commit>" : gitShort();
const releaseDir = `${config.remoteDir}/releases/${commit}`;
const archive = resolve(process.cwd(), `.deploy-${commit}.tar`);
const previousTag = dryRun ? "<previous-tag>" : remote(`cat ${shellQuote(`${config.remoteDir}/ACTIVE_TAG`)} 2>/dev/null || true`, { capture: true });

step("Préflight VPS non destructif");
remote(
  `set -eu; command -v docker >/dev/null; docker compose version >/dev/null; ` +
  `mkdir -p ${shellQuote(`${config.remoteDir}/releases`)}; ` +
  `if docker ps -a --format '{{.Names}}' | grep -Fxq guad-enterprises-app && [ ! -f ${shellQuote(`${config.remoteDir}/OWNER`)} ]; then ` +
  `echo 'Le nom guad-enterprises-app existe sans marqueur GUAD; arrêt préventif.' >&2; exit 21; fi; ` +
  `test ! -e ${shellQuote(`${config.remoteDir}/docker-compose.yml`)} || test -f ${shellQuote(`${config.remoteDir}/OWNER`)}`
);

step(`Transfert de la release ${commit}`);
run("git", ["archive", "--format=tar", "-o", archive, "HEAD"]);
if (!dryRun) run("scp", [...sshArgs, archive, `${config.host}:${releaseDir}/source.tar`]);
else log(`[local] scp ${archive} -> ${config.host}:${releaseDir}/source.tar`);
remote(`mkdir -p ${shellQuote(releaseDir)} && tar -xf ${shellQuote(`${releaseDir}/source.tar`)} -C ${shellQuote(releaseDir)} && rm -f ${shellQuote(`${releaseDir}/source.tar`)}`);
if (!dryRun) rmSync(archive, { force: true });

step("Construction de l'image GUAD sur le VPS");
remote(`docker build -t guad-enterprises-app:${shellQuote(commit)} ${shellQuote(releaseDir)}`);
remote(`install -m 0644 ${shellQuote(`${releaseDir}/docker-compose.vps.yml`)} ${shellQuote(`${config.remoteDir}/docker-compose.yml`)} && ` +
  `touch ${shellQuote(`${config.remoteDir}/OWNER`)} && ` +
  `printf 'GUAD_IMAGE_TAG=%s\\nGUAD_BUILD_CONTEXT=%s\\n' ${shellQuote(commit)} ${shellQuote(releaseDir)} > ${shellQuote(`${config.remoteDir}/.env`)}`);

step("Bascule du seul service GUAD");
remote(`cd ${shellQuote(config.remoteDir)} && docker compose --env-file .env up -d --no-build`);
const localHealth = remote(`for i in $(seq 1 30); do curl -fsS http://127.0.0.1:${config.port}/ >/dev/null && echo HEALTHY && exit 0; sleep 2; done; echo UNHEALTHY`, { capture: true });
if (localHealth !== "HEALTHY") {
  if (previousTag) {
    remote(`printf 'GUAD_IMAGE_TAG=%s\\nGUAD_BUILD_CONTEXT=%s\\n' ${shellQuote(previousTag)} ${shellQuote(`${config.remoteDir}/releases/${previousTag}`)} > ${shellQuote(`${config.remoteDir}/.env`)} && ` +
      `cd ${shellQuote(config.remoteDir)} && docker compose --env-file .env up -d --no-build`);
    fail(`Health-check GUAD KO; rollback vers ${previousTag} effectué.`);
  }
  fail("Health-check GUAD KO; aucune release précédente n'a été modifiée.");
}
remote(`printf '%s\\n' ${shellQuote(commit)} > ${shellQuote(`${config.remoteDir}/ACTIVE_TAG`)}`);
ok(`Service GUAD actif sur 127.0.0.1:${config.port} du VPS`);

if (configureCaddy) {
  step(`Ajout isolé de ${config.publicHost} dans Caddy`);
  const backup = `/etc/caddy/Caddyfile.guatmp-${Date.now()}.bak`;
  remote(`cp -p /etc/caddy/Caddyfile ${shellQuote(backup)} && ` +
    `if ! grep -Fq ${shellQuote(`${config.publicHost} {`)} /etc/caddy/Caddyfile; then ` +
    `printf '\\n${config.publicHost} {\\n\\treverse_proxy 127.0.0.1:${config.port}\\n\\tencode zstd gzip\\n}\\n' >> /etc/caddy/Caddyfile; fi && ` +
    `(caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy || ` +
    `(cp -p ${shellQuote(backup)} /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy && exit 1))`);
  if (!(await publicHealthCheck())) {
    remote(`cp -p ${shellQuote(backup)} /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`);
    fail("URL publique non accessible; la configuration Caddy a été restaurée.");
  }
  ok(`Accès public configuré : ${config.publicUrl}`);
}

log(`\n${color.green}Déploiement GUAD terminé.${color.reset}`);
log(`URL publique prévue : ${config.publicUrl}`);
log(`Mode : ${dryRun ? "DRY-RUN — relancer avec --yes pour exécuter" : "EXÉCUTÉ"}`);
if (previousTag) log(`Release précédente conservée pour rollback : ${previousTag}`);
