// End-to-end proof that the guard keeps the process alive.
//
// Before the fix, an `abortIncoming` rejection terminated the server. This
// script installs the guard, fires the exact error from the field, then proves
// the process is still running.
import { installProcessGuards, isBenignDisconnect } from "../src/lib/processGuards.js";

const logged = [];
const fakeLogger = {
  warn: (...a) => logged.push(["warn", a.join(" ")]),
  error: (...a) => logged.push(["error", a.join(" ")]),
};

installProcessGuards({ logger: fakeLogger });

const aborted = new Error("aborted");
aborted.stack = [
  "Error: aborted",
  "    at abortIncoming (node:_http_server:796:17)",
  "    at socketOnClose (node:_http_server:790:3)",
  "    at Socket.emit (node:events:536:35)",
  "    at TCP.<anonymous> (node:net:343:12)",
].join("\n");

// Fire it exactly like Node would for a dropped client connection.
process.emit("unhandledRejection", aborted, Promise.resolve());

// A genuine bug must still be reported (but not fatal).
const realBug = new Error("Cannot read properties of undefined (reading 'x')");
process.emit("unhandledRejection", realBug, Promise.resolve());

setTimeout(() => {
  const benign = isBenignDisconnect(aborted);
  const warnings = logged.filter(([lvl]) => lvl === "warn");
  const errors = logged.filter(([lvl]) => lvl === "error");

  console.log("survived            :", true, "(reached the timer)");
  console.log("aborted classified  :", benign);
  console.log("benign logged once  :", warnings.length === 1, `(${warnings.length} warning)`);
  console.log("real bug still seen :", errors.length === 1);
  console.log("warn text           :", warnings[0]?.[1]?.slice(0, 80) || "(none)");
  console.log("error text          :", errors[0]?.[1]?.split("\n")[0]?.slice(0, 80) || "(none)");

  const ok = benign && warnings.length === 1 && errors.length === 1;
  console.log(ok ? "\nRESULT: PASS — server stayed up" : "\nRESULT: FAIL");
  process.exit(ok ? 0 : 1);
}, 300);
