import { NextResponse } from "next/server";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// GET /api/proxy-pools/netlify-cli-status
//
// Reports whether a runnable netlify-cli is available BEFORE the user clicks
// Deploy, so the dashboard can offer to install it (or show the manual command)
// instead of letting a deploy start and fail 60s later.
//
// Resolution order mirrors ensureNetlifyCli() in the deploy route:
//   1. a real dependency in node_modules
//   2. the lazily-installed copy under the runtime dir
//   3. a legacy runtime location
//   4. a `netlify` binary on PATH

const requireForCli = createRequire(import.meta.url);

function runtimeBase() {
  const dataDir = process.env.DATA_DIR
    || (process.platform === "win32"
      ? path.join(process.env.APPDATA || os.homedir(), "9router")
      : path.join(os.homedir(), ".9router"));
  return path.join(dataDir, "runtime");
}

function candidates() {
  const out = [];

  // 1. Bundled dependency.
  try {
    out.push({ source: "dependency", path: requireForCli.resolve("netlify-cli/bin/run.js") });
  } catch { /* not installed as a dependency */ }

  // 2. Lazy runtime install.
  out.push({
    source: "runtime",
    path: path.join(runtimeBase(), "netlify-cli", "node_modules", "netlify-cli", "bin", "run.js"),
  });

  // 3. Legacy runtime location.
  out.push({
    source: "runtime-legacy",
    path: path.join(runtimeBase(), "node_modules", "netlify-cli", "bin", "run.js"),
  });

  return out;
}

function findOnPath() {
  const isWin = process.platform === "win32";
  const cmdName = isWin ? "netlify.cmd" : "netlify";
  const dirs = [
    path.join(process.env.APPDATA || "", "npm"),
    path.join(process.env.LOCALAPPDATA || "", "hermes", "tools", "node-26.7.0-win32-x64"),
    process.cwd(),
    path.join(process.cwd(), "node_modules", ".bin"),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, cmdName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function GET() {
  const checked = candidates();
  const found = checked.find((c) => c.path && fs.existsSync(c.path));

  if (found) {
    return NextResponse.json({
      available: true,
      source: found.source,
      path: found.path,
      manualCommand: "npm i -g netlify-cli",
    });
  }

  const onPath = findOnPath();
  if (onPath) {
    return NextResponse.json({
      available: true,
      source: "path",
      path: onPath,
      manualCommand: "npm i -g netlify-cli",
    });
  }

  // A runtime dir that exists but has no entry point is debris from a killed
  // install (OOM, timeout). Report it so the user knows why the next attempt
  // might be slow — the deploy route wipes it before reinstalling.
  const lazyDir = path.join(runtimeBase(), "netlify-cli");
  let staleInstall = false;
  try {
    staleInstall = fs.existsSync(lazyDir);
  } catch {
    staleInstall = false;
  }

  return NextResponse.json({
    available: false,
    // The deploy route installs it automatically on first use; this is the
    // manual fallback when that fails (offline, restricted npm registry, ...).
    autoInstall: true,
    staleInstall,
    manualCommand: "npm i -g netlify-cli",
    installUrl: "https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/",
    checked: checked.map((c) => ({ source: c.source, path: c.path, exists: false })),
  });
}
