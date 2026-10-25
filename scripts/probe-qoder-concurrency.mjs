// Probe: can ONE Qoder account run two models at the same time?
//
// Sends concurrent requests with the SAME credentials and reports whether the
// 10605 admission queue is per-model or per-account. Read-only against the
// account (a tiny 1-token prompt).
// Credentials come from .qoder-creds.tmp.json (written by the caller, never
// committed) so this does not need better-sqlite3.
import { readFileSync } from "fs";
import path from "path";

const CREDS_FILE = path.resolve(".qoder-creds.tmp.json");
const creds = JSON.parse(readFileSync(CREDS_FILE, "utf8"));

const { QoderExecutor } = await import("../open-sse/executors/qoder.js");

const exec = new QoderExecutor("qoder");

const log = {
  debug: () => {}, info: () => {},
  warn: (...a) => console.log("   [warn]", ...a.map(String)),
  error: () => {}, errorLine: () => {}, line: () => {},
};

async function one(model, tag) {
  const t0 = Date.now();
  try {
    const res = await exec.execute({
      model,
      body: { messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
      stream: false,
      credentials: creds,
      signal: AbortSignal.timeout(90_000),
      log,
    });
    let text = "";
    if (res?.response?.body) {
      try { text = JSON.stringify(await res.response.json()).slice(0, 100); } catch { text = "<unreadable>"; }
    }
    return { tag, model, ms: Date.now() - t0, ok: res?.success !== false, status: res?.status, text, error: res?.error };
  } catch (e) {
    return { tag, model, ms: Date.now() - t0, ok: false, error: String(e.message).slice(0, 140) };
  }
}

const show = (r) => {
  const detail = r.error || r.text || "";
  console.log(`  ${r.tag.padEnd(20)} ${String(r.ms).padStart(6)}ms  ok=${String(r.ok).padEnd(5)} ${detail}`);
};

console.log("=== 1. SEQUENTIAL baseline (each model alone) ===");
for (const m of ["dfmodel", "qfmodel"]) {
  show(await one(m, `${m} alone`));
  await new Promise((r) => setTimeout(r, 2000));
}

console.log("\n=== 2. PARALLEL: same account, two DIFFERENT models ===");
{
  const [a, b] = await Promise.all([one("dfmodel", "dfmodel (parallel)"), one("qfmodel", "qfmodel (parallel)")]);
  show(a); show(b);
}

console.log("\n=== 3. PARALLEL: same account, SAME model twice ===");
{
  const [a, b] = await Promise.all([one("dfmodel", "dfmodel #1"), one("dfmodel", "dfmodel #2")]);
  show(a); show(b);
}
