// Is the 10605 queue per-account, per-model, or GLOBAL site-wide?
//
// Strategy: hammer several models concurrently and record the exact 10605
// payload for each. If queueCount is always 0 and the queue appears on models
// nobody is touching, the limit is site-wide capacity, not a real waiting line.
import { readFileSync } from "fs";
import path from "path";

const creds = JSON.parse(readFileSync(path.resolve(".qoder-creds.tmp.json"), "utf8"));
const { QoderExecutor } = await import("../open-sse/executors/qoder.js");

const exec = new QoderExecutor("qoder");
const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, errorLine: () => {}, line: () => {} };

async function probe(model) {
  const t0 = Date.now();
  try {
    const res = await exec.execute({
      model,
      body: { messages: [{ role: "user", content: "hi" }], max_tokens: 8 },
      stream: false,
      credentials: creds,
      signal: AbortSignal.timeout(60_000),
      log,
    });
    const ms = Date.now() - t0;
    if (res?.success === false) {
      // Pull the raw upstream body out of the error string
      const raw = String(res.error || "");
      const q = raw.match(/"queueCount"\s*:\s*(\d+)/);
      const rc = raw.match(/"queueCount"\s*:\s*(\d+)/);
      return { model, ms, queued: /isQueued"?\s*:\s*true/.test(raw), queueCount: rc ? rc[1] : "n/a", msg: raw.slice(0, 110) };
    }
    return { model, ms, queued: false, queueCount: "-", msg: "OK" };
  } catch (e) {
    const raw = String(e.message || "");
    return { model, ms: Date.now() - t0, queued: /isQueued/.test(raw), queueCount: "err", msg: raw.slice(0, 110) };
  }
}

const models = ["dfmodel", "qfmodel", "gmodel", "gfmodel", "kmodel", "dmodel"];

console.log("=== A. each model alone, 2s apart ===");
for (const m of models) {
  const r = await probe(m);
  console.log(`  ${m.padEnd(9)} ${String(r.ms).padStart(6)}ms queued=${String(r.queued).padEnd(5)} qCount=${String(r.queueCount).padEnd(4)} ${r.msg}`);
  await new Promise((x) => setTimeout(x, 2000));
}

console.log("\n=== B. ALL models at once (same account) ===");
const all = await Promise.all(models.map(probe));
for (const r of all) {
  console.log(`  ${r.model.padEnd(9)} ${String(r.ms).padStart(6)}ms queued=${String(r.queued).padEnd(5)} qCount=${String(r.queueCount).padEnd(4)} ${r.msg}`);
}

console.log("\n=== C. one model, 4 requests at once ===");
const burst = await Promise.all([1, 2, 3, 4].map(() => probe("dfmodel")));
burst.forEach((r, i) => {
  console.log(`  dfmodel#${i + 1} ${String(r.ms).padStart(6)}ms queued=${String(r.queued).padEnd(5)} qCount=${String(r.queueCount).padEnd(4)} ${r.msg}`);
});
