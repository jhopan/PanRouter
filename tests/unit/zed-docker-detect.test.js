/**
 * Unit tests for src/lib/oauth/utils/dockerDetect.js
 *
 * The two Docker heuristics must be independently sufficient and never throw:
 * callers use the answer to refuse host-only keychain CLIs inside a container.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isRunningInDocker } from "../../src/lib/oauth/utils/dockerDetect.js";

const tmpDirs = [];

function tempFile(name, content = "") {
  const dir = mkdtempSync(join(tmpdir(), "panrouter-docker-"));
  tmpDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

describe("isRunningInDocker", () => {
  it("detects the /.dockerenv marker", () => {
    const marker = tempFile(".dockerenv");
    const deps = {
      existsSync: (path) => path === "/.dockerenv" && existsSync(marker),
      readFileSync: () => {
        throw new Error("should not read cgroup when the marker exists");
      },
    };
    expect(isRunningInDocker(deps)).toBe(true);
  });

  it("detects docker in /proc/1/cgroup", () => {
    const cgroup = tempFile(
      "cgroup",
      "12:pids:/docker/3f1c9a\n11:memory:/system.slice/docker-3f1c9a.scope\n",
    );
    const deps = {
      existsSync: () => false,
      readFileSync: (path) => {
        expect(path).toBe("/proc/1/cgroup");
        return readFileSync(cgroup, "utf8");
      },
    };
    expect(isRunningInDocker(deps)).toBe(true);
  });

  it("returns false when neither heuristic matches", () => {
    const cgroup = tempFile("cgroup", "0::/user.slice/user-1000.slice\n");
    const deps = {
      existsSync: () => false,
      readFileSync: () => readFileSync(cgroup, "utf8"),
    };
    expect(isRunningInDocker(deps)).toBe(false);
  });

  it("returns false when both probes throw", () => {
    const deps = {
      existsSync: () => {
        throw new Error("EACCES");
      },
      readFileSync: () => {
        throw new Error("ENOENT");
      },
    };
    expect(isRunningInDocker(deps)).toBe(false);
  });

  it("returns false when the cgroup read fails after a missing marker", () => {
    const deps = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("ENOENT");
      },
    };
    expect(isRunningInDocker(deps)).toBe(false);
  });

  it("defaults to the real fs without throwing on this host", () => {
    expect(typeof isRunningInDocker()).toBe("boolean");
  });
});