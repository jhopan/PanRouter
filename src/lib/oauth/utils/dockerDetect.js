import { existsSync, readFileSync } from "fs";

// Best-effort Docker detection for callers that must not run host-only tools
// (keychain CLIs) inside a container. False negatives on exotic runtimes are
// acceptable: callers degrade gracefully and still offer manual import.
// Parity: OmniRoute src/lib/zed-oauth/dockerDetect.ts.

const defaultDeps = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
};

/**
 * Returns true when this process appears to run inside a Docker container.
 * Two Linux heuristics: `/.dockerenv` (written at container start) and the
 * string "docker" in `/proc/1/cgroup`.
 *
 * @param {{ existsSync?: (path: string) => boolean, readFileSync?: (path: string, encoding: string) => string }} [deps]
 *   Injectable fs surface for tests.
 */
export function isRunningInDocker(deps = defaultDeps) {
  try {
    if (deps.existsSync("/.dockerenv")) return true;
  } catch {
    // not Linux or permission denied — fall through
  }
  try {
    const cgroup = deps.readFileSync("/proc/1/cgroup", "utf8");
    if (String(cgroup || "").includes("docker")) return true;
  } catch {
    // not Linux or /proc not mounted
  }
  return false;
}