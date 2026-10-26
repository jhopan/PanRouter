// A dropped client connection must not kill the server.
//
// Crash log from the field:
//
//   Error: aborted
//       at abortIncoming (node:_http_server:796:17)
//       at socketOnClose (node:_http_server:790:3)
//       at Socket.emit (node:events:536:35)
//       at TCP.<anonymous> (node:net:343:12)
//
// `abortIncoming` is Node's internal path for a client that closed the socket
// mid-request. In older Node it surfaced as an unhandled rejection; without a
// process-level handler it terminates the server, and the CLI restarts it and
// prints the whole stderr tail as a "crash log".
//
// A client disconnect is normal traffic. It must be swallowed (and logged once),
// not treated as fatal.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

describe("process-level safety net", () => {
  const instrumentation = read("../src/instrumentation.js");
  const guards = read("../src/lib/processGuards.js");

  it("installs the guards from instrumentation", () => {
    expect(instrumentation).toContain("installProcessGuards");
  });

  it("registers an uncaughtException handler", () => {
    expect(guards).toContain('process.on("uncaughtException"');
  });

  it("registers an unhandledRejection handler", () => {
    expect(guards).toContain('process.on("unhandledRejection"');
  });

  it("only installs them in the nodejs runtime", () => {
    // The edge/browser runtime has no process object.
    const nodeGuard = instrumentation.indexOf('NEXT_RUNTIME === "nodejs"');
    expect(nodeGuard).toBeGreaterThan(-1);
    const installIdx = instrumentation.indexOf("installProcessGuards()");
    expect(installIdx).toBeGreaterThan(nodeGuard);
  });

  it("does not rethrow — the server must stay alive", () => {
    expect(guards).not.toMatch(/throw err/);
    expect(guards).toMatch(/kept server alive/);
  });
});

describe("client disconnects are not crashes", () => {
  it("recognises the abortIncoming signature", () => {
    const mod = read("../src/lib/processGuards.js");
    expect(mod).toContain("abortIncoming");
    expect(mod).toContain("ECONNRESET");
  });

  it("treats a closed socket as a benign disconnect", () => {
    const mod = read("../src/lib/processGuards.js");
    // The list of benign codes/patterns must include the socket-close family.
    expect(mod).toMatch(/EPIPE/);
    expect(mod).toMatch(/ERR_STREAM_PREMATURE_CLOSE/);
  });
});
