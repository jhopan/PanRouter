// Regression: SQLite binds TEXT as a NUL-terminated C string, so a bound string
// with an embedded NUL cannot survive the write.
//
//  - better-sqlite3 rejects it: "TypeError: String contains null byte", which
//    aborts the write and with it the background flush worker.
//  - node:sqlite accepts it and silently keeps only the prefix before the NUL —
//    the rest of the value is gone with no trace.
//
// Telemetry carries values that can contain one: a model id or endpoint taken
// straight from the request, raw bytes out of a tool result, a diff. The write
// must survive and must keep the whole value. (#4917)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stripNullBytes } from "@/lib/db/helpers/nullBytes.js";

// Built at runtime so this source file holds no literal NUL byte.
const NUL = String.fromCharCode(0);
const DIRTY = `before${NUL}after`;

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "panrouter-nul-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  // driver.js captures the shared state object at module load, so the module has
  // to be re-imported per test to get a fresh (open) database.
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("stripNullBytes", () => {
  it("removes NUL bytes and keeps the rest of the text", () => {
    expect(stripNullBytes(DIRTY)).toBe("beforeafter");
    expect(stripNullBytes(`a${NUL}b`)).toBe("ab");
  });

  it("leaves clean strings untouched", () => {
    expect(stripNullBytes("plain text")).toBe("plain text");
    expect(stripNullBytes("")).toBe("");
  });

  it("passes non-strings through unchanged", () => {
    expect(stripNullBytes(42)).toBe(42);
    expect(stripNullBytes(null)).toBe(null);
    expect(stripNullBytes(undefined)).toBe(undefined);
    const buf = Buffer.from([1, 0, 2]);
    expect(stripNullBytes(buf)).toBe(buf);      // BLOBs carry an explicit length
  });
});

describe("the DB driver writes a value that contains a NUL byte", () => {
  it("stores the whole value instead of aborting or truncating", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("CREATE TABLE IF NOT EXISTS nul_probe (id TEXT PRIMARY KEY, value TEXT)");
    db.run("INSERT OR REPLACE INTO nul_probe (id, value) VALUES (?, ?)", ["k1", DIRTY]);

    const row = db.get("SELECT value FROM nul_probe WHERE id = ?", ["k1"]);
    expect(row.value).toBe("beforeafter");       // not truncated at the NUL
    expect(row.value).not.toContain(NUL);
  });

  it("also covers get/all parameters", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("CREATE TABLE IF NOT EXISTS nul_probe2 (id TEXT PRIMARY KEY, value TEXT)");
    db.run("INSERT OR REPLACE INTO nul_probe2 (id, value) VALUES (?, ?)", ["k2", "finder"]);

    expect(db.get("SELECT value FROM nul_probe2 WHERE id = ?", [`k2${NUL}`])?.value).toBe("finder");
    expect(db.all("SELECT value FROM nul_probe2 WHERE id = ?", [`k2${NUL}`]).length).toBe(1);
  });
});
