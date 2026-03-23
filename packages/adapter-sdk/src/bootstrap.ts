import { DEFAULT_POWERLINE_PORT, RUNTIME_MANIFESTS } from "@grackle-ai/common";
import type { ProvisionEvent } from "./adapter.js";
import type { RemoteExecutor } from "./remote-executor.js";
import type { AdapterLogger } from "./logger.js";
import { defaultLogger } from "./logger.js";
import {
  REMOTE_POWERLINE_DIRECTORY,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
  SSH_CONNECTIVITY_TIMEOUT_MS,
  sleep,
  isDevMode,
  getPackageVersion,
  shellEscape,
} from "./utils.js";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Constants ──────────────────────────────────────────────

/** Timeout for `npm install` on the remote host. */
const BOOTSTRAP_NPM_INSTALL_TIMEOUT_MS: number = 120_000;

/** Wait after starting the remote PowerLine process before verifying. */
const POWERLINE_STARTUP_DELAY_MS: number = 2_000;

// ─── Env File Helpers ───────────────────────────────────────

/** Regex for valid POSIX environment variable names. */
const ENV_VAR_NAME_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Build the env-file content string for the PowerLine process.
 * Returns the full file content (with trailing newline), or empty string if
 * there are no env vars to write.
 * @param powerlineToken - The PowerLine authentication token
 * @param extraEnv - Additional environment variables to include
 * @param logger - Logger for diagnostic output
 */
export function buildEnvFileContent(
  powerlineToken: string,
  extraEnv?: Record<string, string>,
  logger: AdapterLogger = defaultLogger,
): string {
  const envLines: string[] = [];
  if (powerlineToken) {
    envLines.push(`export GRACKLE_POWERLINE_TOKEN='${shellEscape(powerlineToken)}'`);
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (!ENV_VAR_NAME_PATTERN.test(key)) {
        logger.warn({ key }, "Skipping invalid env var name");
        continue;
      }
      envLines.push(`export ${key}='${shellEscape(value)}'`);
    }
  }
  if (envLines.length === 0) {
    return "";
  }
  return envLines.join("\n") + "\n";
}

/**
 * Write the environment variable file to the remote PowerLine directory.
 * Used during both initial bootstrap and reconnect (tokens may have rotated).
 */
export async function writeRemoteEnvFile(
  executor: RemoteExecutor,
  powerlineToken: string,
  extraEnv?: Record<string, string>,
  logger: AdapterLogger = defaultLogger,
): Promise<void> {
  const envFileContent = buildEnvFileContent(powerlineToken, extraEnv, logger);
  if (!envFileContent) {
    return;
  }
  const envFileContentBase64 = Buffer.from(envFileContent, "utf8").toString("base64");
  await executor.exec(
    `cd ${REMOTE_POWERLINE_DIRECTORY} && node -e "require('fs').writeFileSync('.env.sh',Buffer.from(process.argv[1],'base64').toString('utf8'))" '${shellEscape(envFileContentBase64)}'`,
    { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
  );
  await executor.exec(
    `chmod 600 ${REMOTE_POWERLINE_DIRECTORY}/.env.sh`,
    { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
  );
}

// ─── Remote Probe ───────────────────────────────────────────

/** Node.js one-liner that probes the PowerLine port and exits 0/1. */
const PROBE_SCRIPT: string =
  `node -e "const s=require('net').createConnection(${DEFAULT_POWERLINE_PORT},'127.0.0.1');`
  + `s.on('connect',()=>{s.destroy();process.exit(0)});`
  + `s.on('error',()=>process.exit(1))"`;

/**
 * Probe whether the remote PowerLine is listening on its port.
 * Throws if the port is not reachable.
 */
export async function probeRemotePowerLine(executor: RemoteExecutor): Promise<void> {
  await executor.exec(PROBE_SCRIPT, { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS });
}

// ─── Remote Kill ────────────────────────────────────────────

/**
 * Build a shell command that kills the remote PowerLine process.
 * Prefers killing by tracked PID (written at startup) to avoid terminating
 * unrelated services on the same port. Falls back to port-based kill.
 */
export function buildRemoteKillCommand(): string {
  const pidfile = `${REMOTE_POWERLINE_DIRECTORY}/powerline.pid`;

  // Try pidfile-based kill first (safe — only kills what we started)
  const pidfileKill = [
    `[ -f "${pidfile}" ]`,
    `PID=$(cat "${pidfile}" 2>/dev/null)`,
    `[ -n "$PID" ]`,
    `kill "$PID" 2>/dev/null`,
    `rm -f "${pidfile}"`,
  ].join(" && ");

  // Fallback: port-based kill (for upgrades from before pidfile support)
  const portKill =
    `fuser -k ${DEFAULT_POWERLINE_PORT}/tcp 2>/dev/null`
    + ` || lsof -ti:${DEFAULT_POWERLINE_PORT} | xargs kill 2>/dev/null`
    + ` || pkill -f "powerline.*${DEFAULT_POWERLINE_PORT}" 2>/dev/null`;

  return `(${pidfileKill}) || (${portKill}) || true`;
}

// ─── Start Remote PowerLine ─────────────────────────────────

/** Options for {@link startRemotePowerLine}. */
export interface StartRemotePowerLineOptions {
  /** Additional environment variables forwarded to the remote PowerLine. */
  extraEnv?: Record<string, string>;
  /** Explicit working directory for the PowerLine process. */
  workingDirectory?: string;
  /**
   * Host address to bind the PowerLine to. Defaults to unset (PowerLine's
   * own default, 127.0.0.1). Use "0.0.0.0" for Docker containers where
   * the port is accessed via Docker's port mapping.
   */
  host?: string;
  /**
   * When true, detects `/workspaces/*\/` on the remote host (codespace
   * convention) and uses it as the working directory.
   */
  autoDetectWorkspace?: boolean;
  /**
   * When true, the compound script starts with a TCP probe and exits
   * immediately if PowerLine is already listening. This avoids a separate
   * SSH round trip for the initial health check.
   */
  probeFirst?: boolean;
  /** Logger for diagnostic output. */
  logger?: AdapterLogger;
}

/** Validate and build the node one-liner that spawns a fully detached PowerLine process. */
function buildSpawnScript(host?: string): string {
  if (host && !/^[\d.a-zA-Z:]+$/.test(host)) {
    throw new Error(`Invalid host address: ${host}`);
  }
  const hostArg = host ? `,'--host=${host}'` : "";
  return (
    `node -e "`
    + `const fs=require('fs');`
    + `const {spawn}=require('child_process');`
    + `const out=fs.openSync(process.argv[3],'w');`
    + `const c=spawn('node',[process.argv[1],'--port=${DEFAULT_POWERLINE_PORT}'${hostArg}],`
    + `{cwd:process.cwd(),detached:true,stdio:['ignore',out,out]});`
    + `fs.writeFileSync(process.argv[2],String(c.pid));`
    + `c.unref();"`
  );
}

/**
 * Ensure the remote PowerLine process is running.
 *
 * Batches env-var write, process start, and port probe into a **single SSH
 * call** to minimize per-call latency (each `gh codespace ssh` round trip
 * takes ~10-15 s through GitHub's relay).
 *
 * Uses Node's `spawn({ detached: true })` to properly daemonize the
 * PowerLine process, avoiding the SSH-hanging issue where `nohup ... &`
 * keeps the session alive through GitHub's codespace relay.
 *
 * When `probeFirst` is true the script begins with a TCP port check and
 * returns immediately if PowerLine is already listening, combining the
 * "is it alive?" check and the "start if not" logic into one SSH call.
 *
 * This is the "restart" middle path — it assumes code is already installed
 * and skips npm install, git checks, and artifact copies.
 */
export async function startRemotePowerLine(
  executor: RemoteExecutor,
  powerlineToken: string,
  options: StartRemotePowerLineOptions = {},
): Promise<{ alreadyRunning: boolean }> {
  const { extraEnv, workingDirectory, host, autoDetectWorkspace, probeFirst, logger = defaultLogger } = options;

  // Validate workingDirectory to prevent shell injection — must be an absolute POSIX path
  if (workingDirectory && !/^\/[\w./-]+$/.test(workingDirectory)) {
    throw new Error(`Invalid working directory: ${workingDirectory}`);
  }

  const envFileContent = buildEnvFileContent(powerlineToken, extraEnv, logger);

  const devMode = isDevMode();
  const entryPoint = devMode
    ? "dist/index.js"
    : "node_modules/@grackle-ai/powerline/dist/index.js";
  const absoluteEntryPoint = `${REMOTE_POWERLINE_DIRECTORY}/${entryPoint}`;
  const logFilePath = "$HOME/.grackle/powerline.log";
  const pidFilePath = `${REMOTE_POWERLINE_DIRECTORY}/powerline.pid`;

  // Build a compound script that runs in a single SSH call:
  //   0. (Optional) Probe — exit early if already listening
  //   1. Write env file (base64 → file)
  //   2. Detect working directory (optional)
  //   3. Source env + spawn PowerLine (detached, exits immediately)
  //   4. Brief sleep + probe
  const parts: string[] = [];

  // 0. Early-exit probe (saves work when PowerLine is already running).
  let probeFirstPrefix = "";
  if (probeFirst) {
    probeFirstPrefix = `${PROBE_SCRIPT} && echo "__PL_ALIVE__" && exit 0; `;
  }

  // 1. Env file
  if (envFileContent) {
    const envFileContentBase64 = Buffer.from(envFileContent, "utf8").toString("base64");
    parts.push(
      `cd ${REMOTE_POWERLINE_DIRECTORY}`
      + ` && node -e "require('fs').writeFileSync('.env.sh',Buffer.from(process.argv[1],'base64').toString('utf8'))"`
      + ` '${shellEscape(envFileContentBase64)}'`
      + ` && chmod 600 .env.sh`,
    );
  }

  // 2. Working directory
  let startDirExpr: string;
  if (workingDirectory) {
    startDirExpr = workingDirectory;
  } else if (autoDetectWorkspace) {
    parts.push(
      `WD=$(ls -d /workspaces/*/ 2>/dev/null | head -1 | sed "s/\\/$//");`
      + ` WD=\${WD:-${REMOTE_POWERLINE_DIRECTORY}}`,
    );
    startDirExpr = "$WD";
  } else {
    startDirExpr = REMOTE_POWERLINE_DIRECTORY;
  }

  // 3. Source env vars and spawn PowerLine as a detached process.
  const sourceEnv = envFileContent
    ? `. ${REMOTE_POWERLINE_DIRECTORY}/.env.sh && `
    : "";
  parts.push(
    `cd "${startDirExpr}" && ${sourceEnv}`
    + `${buildSpawnScript(host)} "${absoluteEntryPoint}" "${pidFilePath}" "${logFilePath}"`,
  );

  // 4. Probe (after a brief pause for the port to bind)
  parts.push(`sleep ${POWERLINE_STARTUP_DELAY_MS / 1000} && ${PROBE_SCRIPT}`);

  const compoundScript = probeFirstPrefix + parts.join(" && ");

  try {
    const stdout = await executor.exec(
      `bash -c '${shellEscape(compoundScript)}'`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );
    if (probeFirst && stdout.includes("__PL_ALIVE__")) {
      logger.info({ port: DEFAULT_POWERLINE_PORT }, "Remote PowerLine was already running");
      return { alreadyRunning: true };
    }
    logger.info({ port: DEFAULT_POWERLINE_PORT }, "Remote PowerLine is listening");
    return { alreadyRunning: false };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.info({ detail }, "Failed to start remote PowerLine");
    throw new Error(
      `PowerLine process died immediately after starting. Check ~/.grackle/powerline.log on the remote host. Cause: ${detail}`,
    );
  }
}

// ─── Bootstrap PowerLine ────────────────────────────────────

/** Options for {@link bootstrapPowerLine}. */
export interface BootstrapOptions {
  /** Additional environment variables forwarded to the remote PowerLine. */
  extraEnv?: Record<string, string>;
  /** Explicit working directory for the PowerLine process. */
  workingDirectory?: string;
  /**
   * Host address to bind the PowerLine to. Defaults to unset (PowerLine's
   * own default, 127.0.0.1). Use "0.0.0.0" for Docker containers where
   * the port is accessed via Docker's port mapping.
   */
  host?: string;
  /** Logger for diagnostic output. */
  logger?: AdapterLogger;
  /** Callback to check whether the GitHub credential provider is enabled. */
  isGitHubProviderEnabled?: () => boolean;
  /**
   * Default runtime to eagerly install during provisioning.
   * When set, the runtime's packages are pre-installed into
   * `~/.grackle/runtimes/<name>/` so the first spawn is instant.
   */
  defaultRuntime?: string;
}

/**
 * Bootstrap the PowerLine on a remote host via the given executor.
 * Yields progress events for each stage of the process.
 */
export async function* bootstrapPowerLine(
  executor: RemoteExecutor,
  powerlineToken: string,
  options: BootstrapOptions = {},
): AsyncGenerator<ProvisionEvent> {
  const {
    extraEnv,
    workingDirectory,
    host,
    logger = defaultLogger,
    isGitHubProviderEnabled,
    defaultRuntime,
  } = options;

  // 1. Check Node.js (PowerLine requires >= 22)
  yield { stage: "bootstrapping", message: "Checking Node.js on remote host...", progress: 0.10 };
  try {
    const nodeVersionOutput = await executor.exec("node --version", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
    const nodeVersion = String(nodeVersionOutput).trim();
    logger.info({ nodeVersion }, "Remote Node.js version");

    const versionMatch = nodeVersion.match(/^v?(\d+)\./);
    if (!versionMatch) {
      throw new Error(
        `Unable to parse Node.js version "${nodeVersion}" on remote host. Install Node.js >= 22 and try again.`,
      );
    }

    const majorVersion = parseInt(versionMatch[1]!, 10);
    if (isNaN(majorVersion) || majorVersion < 22) {
      throw new Error(
        `Unsupported Node.js version "${nodeVersion}" on remote host. PowerLine requires Node.js >= 22.`,
      );
    }
  } catch (error) {
    if (error instanceof Error
      && (error.message.startsWith("Unable to parse Node.js version")
        || error.message.startsWith("Unsupported Node.js version"))) {
      throw error;
    }
    throw new Error(
      "Node.js is not installed or not accessible on the remote host. Install Node.js >= 22 and try again.",
    );
  }

  // 2. Check git
  yield { stage: "bootstrapping", message: "Checking git on remote host...", progress: 0.15 };
  try {
    await executor.exec("git --version", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
  } catch {
    throw new Error("git is not installed on the remote host. Install git and try again.");
  }

  // 2.5. Capture GITHUB_TOKEN from remote host for git push connectivity.
  let enrichedExtraEnv = extraEnv;
  const hasLocalToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const hasAdapterToken = extraEnv?.GITHUB_TOKEN || extraEnv?.GH_TOKEN;
  const githubProviderEnabled = isGitHubProviderEnabled ? isGitHubProviderEnabled() : false;
  if (githubProviderEnabled && !hasLocalToken && !hasAdapterToken) {
    try {
      const remoteToken = (
        await executor.exec(
          `(grep -m1 '^GITHUB_TOKEN=' /workspaces/.codespaces/shared/.env 2>/dev/null | cut -d= -f2- || grep -m1 '^GH_TOKEN=' /workspaces/.codespaces/shared/.env 2>/dev/null | cut -d= -f2- || printenv GITHUB_TOKEN 2>/dev/null || printenv GH_TOKEN 2>/dev/null || true)`,
          { timeout: SSH_CONNECTIVITY_TIMEOUT_MS },
        )
      ).trim();
      if (remoteToken) {
        enrichedExtraEnv = { ...extraEnv, GITHUB_TOKEN: remoteToken };
        logger.info({}, "Captured GITHUB_TOKEN from remote host for agent git operations");
      }
    } catch {
      logger.debug({}, "Could not read GITHUB_TOKEN from remote host");
    }
  }

  // 3. Install PowerLine — dev mode (copy artifacts) vs production (npm install)
  const devMode = isDevMode();

  if (devMode) {
    // ── Dev mode: copy local monorepo artifacts ──

    yield { stage: "bootstrapping", message: "Creating remote directories...", progress: 0.20 };
    await executor.exec(
      `mkdir -p ${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle-ai/common`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );

    // Resolve local artifact paths relative to adapter-sdk's built location.
    // import.meta.dirname = packages/adapter-sdk/dist → up 2 levels → packages/
    const sdkDistDir = resolve(import.meta.dirname);
    const powerlinePackageDir = resolve(sdkDistDir, "../../powerline");

    /** Workspace packages that PowerLine needs at runtime (besides powerline itself). */
    const workspacePackages: Array<[string, string]> = [
      ["common", resolve(sdkDistDir, "../../common")],
      ["mcp", resolve(sdkDistDir, "../../mcp")],
      ["auth", resolve(sdkDistDir, "../../auth")],
    ];

    yield { stage: "bootstrapping", message: "Copying PowerLine artifacts...", progress: 0.25 };
    await executor.copyTo(
      join(powerlinePackageDir, "dist"),
      `${REMOTE_POWERLINE_DIRECTORY}/dist`,
    );
    await executor.copyTo(
      join(powerlinePackageDir, "package.json"),
      `${REMOTE_POWERLINE_DIRECTORY}/package.json`,
    );

    // Collect non-workspace deps from all workspace packages
    const extraDeps: Record<string, string> = {};
    for (const [, dir] of workspacePackages) {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      for (const [k, v] of Object.entries(pkg.dependencies || {})) {
        if (!k.startsWith("@grackle-ai/")) {
          extraDeps[k] = v;
        }
      }
    }

    // Strip @grackle-ai/* workspace deps, merge in common/mcp deps, then npm install once.
    yield { stage: "bootstrapping", message: "Installing dependencies on remote host...", progress: 0.40 };
    const extraDepsJson = JSON.stringify(extraDeps).replace(/'/g, "'\\''");
    await executor.exec(
      `cd ${REMOTE_POWERLINE_DIRECTORY} && node -e "`
      + `const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));`
      + `for(const k of Object.keys(p.dependencies||{})){if(k.startsWith('@grackle-ai/'))delete p.dependencies[k];}`
      + `for(const k of Object.keys(p.devDependencies||{})){if(k.startsWith('@grackle-ai/'))delete p.devDependencies[k];}`
      + `Object.assign(p.dependencies||{},JSON.parse(process.argv[1]));`
      + `require('fs').writeFileSync('package.json',JSON.stringify(p,null,2));" '${extraDepsJson}'`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );
    await executor.exec(
      `cd ${REMOTE_POWERLINE_DIRECTORY} && npm install --omit=dev --registry=https://registry.npmjs.org`,
      { timeout: BOOTSTRAP_NPM_INSTALL_TIMEOUT_MS },
    );

    // Copy @grackle-ai/* packages AFTER all npm installs (npm wipes unmanaged dirs)
    for (const [name, dir] of workspacePackages) {
      const remotePkgDir = `${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle-ai/${name}`;
      yield { stage: "bootstrapping", message: `Copying @grackle-ai/${name}...`, progress: name === "common" ? 0.57 : 0.59 };
      await executor.exec(`mkdir -p ${remotePkgDir}`, { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS });
      await executor.copyTo(join(dir, "dist"), `${remotePkgDir}/dist`);
      await executor.copyTo(join(dir, "package.json"), `${remotePkgDir}/package.json`);
    }
  } else {
    // ── Production mode: npm install from registry ──
    const version = getPackageVersion();

    yield { stage: "bootstrapping", message: "Creating remote directories...", progress: 0.20 };
    await executor.exec(
      `mkdir -p ${REMOTE_POWERLINE_DIRECTORY}`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );

    yield { stage: "bootstrapping", message: `Installing @grackle-ai/powerline@${version}...`, progress: 0.25 };
    await executor.exec(
      `cd ${REMOTE_POWERLINE_DIRECTORY} && npm init -y && npm install @grackle-ai/powerline@${version} --omit=dev --registry=https://registry.npmjs.org`,
      { timeout: BOOTSTRAP_NPM_INSTALL_TIMEOUT_MS },
    );
  }

  logger.info({ devMode }, "PowerLine bootstrap mode");

  // 4. Configure git credential helper so agents can push to GitHub.
  yield { stage: "bootstrapping", message: "Configuring git credentials...", progress: 0.56 };
  try {
    const credHelperScript = '#!/bin/sh\ntest "$1" = get || exit 0\necho "username=x-access-token"\necho "password=${GITHUB_TOKEN:-$GH_TOKEN}"\n';
    const credHelperBase64 = Buffer.from(credHelperScript, "utf8").toString("base64");
    const credHelperPath = `${REMOTE_POWERLINE_DIRECTORY}/git-credential-github.sh`;
    await executor.exec(
      `node -e "require('fs').writeFileSync(process.argv[1],Buffer.from(process.argv[2],'base64').toString('utf8'),{mode:0o755})" `
      + `"${credHelperPath}" '${credHelperBase64}'`
      + ` && git config --global credential.helper "${credHelperPath}"`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );
    logger.info({ path: credHelperPath }, "Git credential helper configured");
  } catch (err) {
    logger.warn({ err }, "Failed to configure git credential helper (agents may be unable to push)");
  }

  // 4.5. Eagerly install the default runtime's packages on the remote host
  //       so the first spawn doesn't need a cold install.
  if (defaultRuntime) {
    const runtimeManifest = RUNTIME_MANIFESTS[defaultRuntime];
    if (runtimeManifest) {
      const runtimeDir = `$HOME/.grackle/runtimes/${defaultRuntime}`;
      const runtimePackageJson = JSON.stringify({
        name: `grackle-runtime-${defaultRuntime}`,
        version: "1.0.0",
        private: true,
        dependencies: runtimeManifest.packages,
      });
      const runtimePkgBase64 = Buffer.from(runtimePackageJson, "utf8").toString("base64");
      // Expected manifest used both for up-to-date checks and for writing manifest.json
      const manifestJson = JSON.stringify({
        powerlineVersion: getPackageVersion(),
        packages: runtimeManifest.packages,
      });
      const manifestBase64 = Buffer.from(manifestJson, "utf8").toString("base64");
      try {
        // Ensure runtime directory exists on remote host
        await executor.exec(
          `mkdir -p ${runtimeDir}`,
          { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
        );

        // Fast-path: check if existing manifest.json matches expected version and packages
        let runtimeUpToDate = false;
        try {
          await executor.exec(
            `cd ${runtimeDir} && node -e "const fs=require('fs');let c;try{c=JSON.parse(fs.readFileSync('manifest.json','utf8'));}catch(e){process.exit(1);}const e=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));function pkgsEqual(a,b){if(!a||!b)return false;const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();if(ak.length!==bk.length)return false;for(let i=0;i<ak.length;i++){if(ak[i]!==bk[i]||a[ak[i]]!==b[bk[i]])return false;}return true;}if(c.powerlineVersion===e.powerlineVersion&&pkgsEqual(c.packages,e.packages)){process.exit(0);}process.exit(1);" '${shellEscape(manifestBase64)}'`,
            { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
          );
          runtimeUpToDate = true;
        } catch {
          runtimeUpToDate = false;
        }

        if (!runtimeUpToDate) {
          yield { stage: "bootstrapping", message: `Installing ${defaultRuntime} runtime...`, progress: 0.57 };
          // Write package.json and install dependencies when runtime is missing or stale
          await executor.exec(
            `cd ${runtimeDir}`
            + ` && node -e "require('fs').writeFileSync('package.json',Buffer.from(process.argv[1],'base64').toString('utf8'))" '${shellEscape(runtimePkgBase64)}'`,
            { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
          );
          await executor.exec(
            `cd ${runtimeDir} && npm install --omit=dev --registry=https://registry.npmjs.org`,
            { timeout: BOOTSTRAP_NPM_INSTALL_TIMEOUT_MS },
          );
          // Write manifest.json for future staleness checks by the PowerLine runtime installer
          await executor.exec(
            `cd ${runtimeDir} && node -e "require('fs').writeFileSync('manifest.json',Buffer.from(process.argv[1],'base64').toString('utf8'))" '${shellEscape(manifestBase64)}'`,
            { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
          );
          logger.info({ defaultRuntime, runtimeDir }, "Default runtime pre-installed on remote host");
        } else {
          logger.info({ defaultRuntime, runtimeDir }, "Default runtime already up to date on remote host; skipping pre-install");
        }
      } catch (err) {
        logger.warn({ defaultRuntime, err }, "Failed to pre-install default runtime (will be installed on first spawn)");
      }
    }
  }

  // 5. Kill any existing PowerLine process on the port (with fallbacks)
  yield { stage: "bootstrapping", message: "Stopping any existing PowerLine process...", progress: 0.60 };
  try {
    await executor.exec(buildRemoteKillCommand(), { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS });
    await sleep(1_000);
  } catch {
    // Ignore — no process to kill
  }

  // 6–8. Write env vars, start process, wait, verify
  yield { stage: "bootstrapping", message: "Starting PowerLine on remote host...", progress: 0.65 };
  await startRemotePowerLine(executor, powerlineToken, { extraEnv: enrichedExtraEnv, workingDirectory, host, logger });

  yield { stage: "bootstrapping", message: "PowerLine is running on remote host", progress: 0.75 };
}
