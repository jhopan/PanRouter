// Force an Antigravity usage probe against the local DB connection and report
// the eligibility verdict. Used to check whether an account that was flagged
// (VALIDATION_REQUIRED) has become eligible again after a browser verification.
//
// Run from the repo root:  node scripts/check-ag-eligibility.mjs
import { DatabaseSync } from "node:sqlite";

const DB = "C:/Users/ACER/AppData/Roaming/9router/db/data.sqlite";
const db = new DatabaseSync(DB, { readOnly: true });
const rows = db.prepare("SELECT id, data FROM providerConnections WHERE provider='antigravity'").all();
db.close();

if (rows.length === 0) {
  console.log("no antigravity connection found");
  process.exit(0);
}

const { getUsageForProvider } = await import("../open-sse/services/usage.js");
const { getAntigravityIneligibility } = await import("../open-sse/services/antigravityCapCache.js");

for (const { id, data } of rows) {
  const conn = JSON.parse(data);
  const cached = getAntigravityIneligibility(id);
  console.log(`connection ${id.slice(0, 8)}`);
  console.log(`  cached flag : ${cached ? `${cached.reasonCode} (flagged)` : "none"}`);

  try {
    const usage = await getUsageForProvider({ ...conn, provider: "antigravity" }, null, { force: true });
    console.log(`  message     : ${usage?.message || "(none)"}`);
    console.log(`  ineligible  : ${JSON.stringify(usage?.ineligible || null)}`);
    console.log(`  quota rows  : ${Object.keys(usage?.quotas || {}).join(", ") || "(none)"}`);
  } catch (e) {
    console.log(`  probe error : ${e.message}`);
  }
}
