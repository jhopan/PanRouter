import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const modal = read("../src/shared/components/OAuthModal.js");
const route = read("../src/app/api/oauth/[provider]/[action]/route.js");
const oauthIndex = read("../src/lib/oauth/providers/index.js");

// Pull the array literal out of a `const NAME = [ ... ];` declaration.
function arrayLiteral(source, name) {
  const start = source.indexOf(`const ${name} = [`);
  if (start === -1) return null;
  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  if (close === -1) return null;
  return [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const DEVICE_CODE_PROVIDERS = arrayLiteral(modal, "deviceCodeProviders");
const NO_PKCE_DEVICE_PROVIDERS = arrayLiteral(route, "noPkceDeviceProviders");

describe("MiniMax Code OAuth wiring", () => {
  it("registers both regional providers in the oauth index", () => {
    expect(oauthIndex).toContain('"minimax-code": minimaxCode');
    expect(oauthIndex).toContain('"minimax-code-global": minimaxCodeGlobal');
  });

  it("declares the device_code flow for both regions", () => {
    const shared = read("../src/lib/oauth/providers/minimax-code-shared.js");
    expect(shared).toContain('flowType: "device_code"');
  });

  it.each(["minimax-code", "minimax-code-global"])(
    "%s is offered in the OAuth modal device-code list",
    (provider) => {
      expect(DEVICE_CODE_PROVIDERS).toContain(provider);
    },
  );

  it.each(["minimax-code", "minimax-code-global"])(
    "%s is NOT in the no-PKCE device list (it needs a code challenge)",
    (provider) => {
      expect(NO_PKCE_DEVICE_PROVIDERS).not.toContain(provider);
    },
  );

  it("keeps the modal and the route lists in sync for no-PKCE providers", () => {
    // Every no-PKCE device provider must still be reachable from the modal,
    // otherwise the flow exists but no UI ever starts it.
    for (const provider of NO_PKCE_DEVICE_PROVIDERS) {
      expect(DEVICE_CODE_PROVIDERS).toContain(provider);
    }
  });

  it("offers every device_code provider in the modal", () => {
    // Guard against the whole class of bug: a provider file declaring
    // flowType "device_code" that no UI path ever reaches. minimax-code-global
    // shipped in exactly that state.
    const dir = path.resolve("../src/lib/oauth/providers");
    const deviceCodeFiles = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .filter((f) => read(path.join("../src/lib/oauth/providers", f)).includes('flowType: "device_code"'));

    // Files that are factories, not provider ids.
    const FACTORIES = new Set(["minimax-code-shared.js"]);

    for (const file of deviceCodeFiles) {
      const id = file.replace(/\.js$/, "");
      if (FACTORIES.has(file)) continue;
      // minimax-code-global is registered from minimax-code-shared, not its own
      // file, so both ids are asserted explicitly above.
      expect(DEVICE_CODE_PROVIDERS).toContain(id);
    }
  });
});

describe("device-code provider reachability (full chain)", () => {
  // The modal list is only the last link. A provider also needs:
  //   1. an entry in the oauth provider index (so /device-code resolves)
  //   2. authModes including "oauth" (so the page opens the modal at all)
  //   3. a category the dashboard renders
  // This test walks the chain so a provider cannot be "wired" on paper only.
  const providerPage = read("../src/app/(dashboard)/dashboard/providers/[id]/page.js");
  const registryIndex = read("../open-sse/providers/registry/index.js");

  const DEVICE_CODE_IDS = DEVICE_CODE_PROVIDERS.filter(
    (id) => !["kimi-coding"].includes(id),
  );

  it.each(DEVICE_CODE_IDS)("%s resolves to a registry entry", (id) => {
    const registryFile = `../open-sse/providers/registry/${id}.js`;
    expect(fs.existsSync(path.resolve(registryFile))).toBe(true);
  });

  it.each(DEVICE_CODE_IDS)("%s is reachable as an OAuth provider", (id) => {
    // The providers page opens the OAuth modal when any of these hold:
    //   category "oauth" | category "free" | authModes includes "oauth"
    const src = read(`../open-sse/providers/registry/${id}.js`);
    const reachable = /category:\s*"(oauth|free)"/.test(src)
      || /authModes:\s*\[[^\]]*"oauth"/.test(src);
    expect(reachable).toBe(true);
  });

  it("the providers page treats authModes oauth as OAuth (opens the modal)", () => {
    expect(providerPage).toContain('authModes.includes("oauth")');
  });
});
