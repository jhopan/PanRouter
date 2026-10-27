// A/B probe: does the missing header set cause 11128 "request illegal"?
//
// Sends the SAME tiny chat request twice against the real CodeBuddy endpoint:
//   A. headers PanRouter sends today
//   B. headers the official CLI sends (adds X-Userinfo / X-Auth-Method /
//      X-Id-Source / X-Trace-ID / X-Root-Request-ID / X-Session-ID / X-Model-ID)
//
// If A fails with 11128 and B succeeds, the headers are the gate.
import { readFileSync } from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";

const creds = JSON.parse(readFileSync(path.resolve(".cb-creds.tmp.json"), "utf8"));
const TOKEN = creds.accessToken;
const URL = "https://www.codebuddy.ai/v2/chat/completions";

const sha = (v) => createHash("sha256").update(String(v)).digest("hex");
const uuidFrom = (seed) => {
  const h = sha(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const body = {
  model: "deepseek-v4.1-flash",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "say ok" },
  ],
  stream: true,
  max_tokens: 16,
};

// ---- A: what PanRouter sends today -----------------------------------------
function headersA(convId, reqId) {
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${TOKEN}`,
    "User-Agent": "IDE/2.170.0 CodeBuddy/2.170.0",
    "X-Product": "SaaS",
    "X-Product-Version": "2.170.0",
    "X-App": "cli",
    "X-IDE-Type": "IDE",
    "X-IDE-Name": "IDE",
    "X-IDE-Version": "2.170.0",
    "X-Private-Data": "false",
    "X-Requested-With": "XMLHttpRequest",
    "X-CodeBuddy-Request": "1",
    "X-Agent-Intent": "craft",
    "X-Agent-Purpose": "conversation",
    "X-Agent-Type": "ide",
    "X-Agent-Runtime": "ide",
    "X-Request-ID": reqId,
    "X-Conversation-ID": convId,
    "X-Conversation-Request-ID": reqId,
    "X-Conversation-Message-ID": reqId,
    "X-Domain": "codebuddy.ai",
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": "6.25.0",
    "X-Stainless-OS": "Windows",
    "X-Stainless-Arch": "amd64",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": process.version,
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Helper-Method": "chat.completions.create",
  };
}

// ---- B: what the CLI sends (adds the identity/trace family) ----------------
function headersB(convId, reqId) {
  const uid = creds.providerSpecificData?.userId || "";
  const userinfo = Buffer.from(
    JSON.stringify({ uin: uid, token_source: "device" }),
    "utf-8",
  ).toString("base64");
  return {
    ...headersA(convId, reqId),
    "X-User-Id": uid,
    "X-Userinfo": userinfo,
    "X-Auth-Method": "device",
    "X-Id-Source": "codebuddy",
    "X-Trace-ID": reqId,
    "X-Root-Request-ID": reqId,
    "X-Session-ID": convId,
    "X-Model-ID": body.model,
    "X-Compaction": "none",
    "X-Context-Compacted": "false",
  };
}

async function send(label, headers) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    let summary = text.slice(0, 240).replace(/\s+/g, " ");
    if (res.ok) {
      const m = text.match(/"content":"([^"]*)"/);
      const done = text.includes("[DONE]") || text.includes('"finish_reason"');
      summary = `OK · stream=${done} · ${m ? m[1].slice(0, 40) : "(no content chunk)"}`;
    }
    return { label, status: res.status, ms, summary };
  } catch (e) {
    return { label, status: "ERR", ms: Date.now() - t0, summary: String(e.message).slice(0, 160) };
  }
}

const convId = uuidFrom("probe-conv-" + Date.now());
console.log("model:", body.model);
console.log("conversation:", convId.slice(0, 18), "\n");

for (const round of [1, 2]) {
  const a = await send(`A (PanRouter headers) round ${round}`, headersA(convId, randomUUID()));
  console.log(`  ${a.label.padEnd(32)} ${String(a.status).padEnd(4)} ${String(a.ms).padStart(6)}ms  ${a.summary}`);
  await new Promise((r) => setTimeout(r, 2500));

  const b = await send(`B (CLI headers) round ${round}`, headersB(convId, randomUUID()));
  console.log(`  ${b.label.padEnd(32)} ${String(b.status).padEnd(4)} ${String(b.ms).padStart(6)}ms  ${b.summary}`);
  await new Promise((r) => setTimeout(r, 2500));
}
