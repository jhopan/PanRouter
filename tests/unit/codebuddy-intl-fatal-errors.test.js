// Request-level rejections must not lock or rotate accounts.
//
// Observed failure: a 1,054,321-token prompt (over the 1,048,576 limit) returned
// 11115, chat.js called markAccountUnavailable on it, and the router walked all
// 18 accounts locking each one for 30s on a request that can never succeed.
//
// Separately, 11128 ("request illegal") fell through to the generic backoff and
// escalated to a 1800s modelLock on a healthy account.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const exec = new CodeBuddyIntlExecutor();
const parse = (obj) => exec.parseError({ status: 400 }, JSON.stringify(obj));

describe("codebuddy-intl — 11115 prompt too long", () => {
  const body = {
    code: 11115,
    msg: "prompt is too long: 1054321 tokens > 1048576 maximum",
    extError: { code: "invalid_request_error" },
  };

  it("is fatal, so chat.js returns instead of trying the next account", () => {
    const p = parse(body);
    expect(p.fatal).toBe(true);
    expect(p.requestTooLarge).toBe(true);
  });

  it("carries no resetsAtMs — there is nothing to wait for", () => {
    expect(parse(body).resetsAtMs).toBeUndefined();
  });

  it("is not classified as an account restriction", () => {
    expect(parse(body).accountRestricted).toBeUndefined();
    expect(parse(body).banned).toBeUndefined();
  });

  it("maps to 400, the real cause", () => {
    expect(parse(body).status).toBe(400);
  });

  it("detects the message without the code", () => {
    expect(parse({ msg: "内容过长，请精简或新建任务" }).fatal).toBe(true);
  });
});

describe("codebuddy-intl — 11128 request illegal", () => {
  const body = { code: 11128, msg: "request illegal" };

  it("is fatal instead of escalating backoff to 1800s", () => {
    const p = parse(body);
    expect(p.fatal).toBe(true);
    expect(p.requestRejected).toBe(true);
  });

  it("does not request a long cooldown", () => {
    expect(parse(body).resetsAtMs).toBeUndefined();
  });
});

describe("codebuddy-intl — 11140 wins over 11128", () => {
  it("classifies the restriction even though msg is 'request illegal'", () => {
    // The 11140 body carries msg:"request illegal" AND the restriction text in
    // displayMsg. The 11128 branch must not swallow it.
    const p = parse({
      code: 11140,
      msg: "request illegal",
      displayMsg: { en: "Your account has been restricted due to unusual activity" },
    });
    // A ban is not a timed cooldown: no resetsAtMs, and the `banned` flag makes
    // auth.js park the WHOLE account for weeks instead of re-testing it every
    // 12 hours (which is the retry pattern the ban was issued for).
    expect(p.banned).toBe(true);
    expect(p.fatal).toBeUndefined();
    expect(p.resetsAtMs).toBeUndefined();
  });
});

describe("chat.js — fatal errors short-circuit", () => {
  const chat = read("../src/sse/handlers/chat.js");

  it("returns immediately on a fatal result", () => {
    expect(chat).toContain("result.fatal === true");
    expect(chat).toMatch(/fatal request error/);
  });

  it("checks fatal BEFORE markAccountUnavailable", () => {
    const fatalIdx = chat.indexOf("result.fatal === true");
    const markIdx = chat.indexOf("markAccountUnavailable(credentials.connectionId");
    expect(fatalIdx).toBeGreaterThan(-1);
    expect(markIdx).toBeGreaterThan(-1);
    expect(fatalIdx).toBeLessThan(markIdx);
  });
});

describe("error plumbing — fatal survives the round trip", () => {
  const errorUtil = read("../open-sse/utils/error.js");
  const chatCore = read("../open-sse/handlers/chatCore.js");

  it("parseUpstreamError forwards fatal, accountRestricted and banned", () => {
    expect(errorUtil).toContain("fatal: parsed.fatal === true");
    expect(errorUtil).toContain("accountRestricted: parsed.accountRestricted === true");
    expect(errorUtil).toContain("banned: parsed.banned === true");
  });

  it("createErrorResult accepts and propagates the flags", () => {
    expect(errorUtil).toContain("flags = null");
    expect(errorUtil).toMatch(/flags\?\.fatal \? \{ fatal: true \}/);
  });

  it("chatCore passes the flags through", () => {
    expect(chatCore).toMatch(/\{ fatal, accountRestricted, queueThrottle, banned \}/);
  });
});
