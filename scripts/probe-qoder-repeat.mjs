// Repeat one model several times to see whether the 10605 admission queue is
// transient (shared capacity) or persistent (model disabled for the account).
import { readFileSync } from "fs";
import path from "path";

const creds = JSON.parse(readFileSync(path.resolve(".qoder-creds.tmp.json"), "utf8"));
const { QoderExecutor } = await import("../open-sse/executors/qoder.js");

const exec = new QoderExecutor("qoder");
const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, errorLine: () => {}, line: () => {} };

const model = process.argv[2] || "qfmodel";
const rounds = Number(process.argv[3] || 6);

for (let i = 1; i <= rounds; i += 1) {
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
    let detail = "";
    if (res?.response?.body) {
      try { detail = JSON.stringify(await res.response.json()).slice(0, 80); } catch { detail = "<unreadable>"; }
    }
    const ok = res?.success !== false;
    console.log(`#${i} ${String(Date.now() - t0).padStart(6)}ms ok=${String(ok).padEnd(5)} ${ok ? detail : String(res?.error || "").slice(0, 90)}`);
  } catch (e) {
    console.log(`#${i} ${String(Date.now() - t0).padStart(6)}ms ERR   ${String(e.message).slice(0, 90)}`);
  }
  await new Promise((r) => setTimeout(r, 2500));
}
