// Live probe: send a real chat through the PanRouter Qoder executor with the
// new CLI-matching headers, and report what Qoder answers.
//
// Uses the credentials from the local PanRouter DB (read-only) and the same
// code path the router uses, so the result reflects the real request.
import { readFileSync } from "fs";
import path from "path";

// Credentials are written by the caller (better-sqlite3's native build does not
// match this Node version), so the probe stays dependency-free.
const CREDS_FILE = path.resolve(".qoder-probe.tmp.json");
const creds = JSON.parse(readFileSync(CREDS_FILE, "utf-8"));

const { QoderExecutor } = await import("../open-sse/executors/qoder.js");
const { buildCosyHeaders } = await import("../open-sse/shared/qoder/cosy.js");

// ── Show the headers we are about to send ──────────────────────────────────
const preview = buildCosyHeaders(Buffer.from("{}"), "https://api2.qoder.sh/x", {
  userId: creds.providerSpecificData.userId,
  authToken: creds.accessToken,
  machineId: creds.providerSpecificData.machineId,
});
console.log("=== HEADERS ===");
for (const k of Object.keys(preview).sort()) {
  if (/Authorization|Cosy-Key/i.test(k)) continue;
  console.log(`  ${k}: ${String(preview[k]).slice(0, 55)}`);
}

const exec = new QoderExecutor("qoder");
const log = {
  debug: () => {}, info: () => {},
  warn: (...a) => console.log("  [warn]", ...a.map(String)),
  error: (...a) => console.log("  [err]", ...a.map(String)),
  errorLine: () => {}, line: () => {},
};

const models = process.argv.slice(2);
const list = models.length ? models : ["dfmodel", "gfmodel", "qfmodel"];

for (const model of list) {
  const t0 = Date.now();
  try {
    const res = await exec.execute({
      model,
      body: { messages: [{ role: "user", content: "say ok" }], max_tokens: 32 },
      stream: false,
      credentials: creds,
      signal: AbortSignal.timeout(90_000),
      log,
    });
    let body = "";
    if (res?.response?.body) {
      try { body = JSON.stringify(await res.response.json()).slice(0, 260); }
      catch { body = "<unreadable>"; }
    }
    console.log(`\n[${model}] ${res?.status ?? "?"} ok=${res?.success !== false} ${Date.now() - t0}ms`);
    if (body) console.log(`   ${body}`);
    if (res?.error) console.log(`   ERR: ${String(res.error).slice(0, 200)}`);
  } catch (e) {
    console.log(`\n[${model}] THREW ${Date.now() - t0}ms: ${String(e.message).slice(0, 200)}`);
  }
}
