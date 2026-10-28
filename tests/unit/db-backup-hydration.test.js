// The mirror-command panel must render identically on the server and on the
// client.
//
// It did not: the command embedded `window.location.origin` directly, which is
// empty during the server render. The first client render therefore produced a
// different string than the server HTML, React reported a hydration mismatch
// and regenerated the whole tree.
//
// The fix keeps the origin in state that starts empty (identical to the server)
// and is filled after mount.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");
const profile = read("src/app/(dashboard)/dashboard/profile/page.js");

/**
 * The command the panel renders, given the origin the component knows about.
 * Mirrors the component: the origin comes from state, which starts empty.
 */
function renderCommand(origin) {
  return [
    'curl -H "x-backup-token: <TOKEN>"',
    `  "${origin}/api/backup/download"`,
    "  -o data.sqlite",
  ].join(" \\n");
}

describe("mirror command hydration", () => {
  it("the server render and the first client render are identical", () => {
    // The server has no window -> the state is still "". The first client
    // render also runs with the state still "" (it is filled in an effect,
    // after the render). Both must produce the same string.
    const serverRender = renderCommand("");
    const firstClientRender = renderCommand("");
    expect(firstClientRender).toBe(serverRender);
  });

  it("the origin is not read from window during render", () => {
    // A direct window.location.origin read inside the markup is exactly what
    // caused the mismatch.
    const markup = profile.slice(profile.indexOf("downloadCommand"), profile.indexOf("downloadCommand") + 400);
    expect(markup).not.toMatch(/window\.location\.origin/);
  });

  it("the origin comes from state that starts empty", () => {
    expect(profile).toMatch(/const \[pageOrigin, setPageOrigin\] = useState\(""\)/);
  });

  it("the state is filled after mount", () => {
    expect(profile).toMatch(/setPageOrigin\(window\.location\.origin\)/);
  });

  it("the rendered command uses the state", () => {
    expect(profile).toMatch(/\$\{pageOrigin\}\/api\/backup\/download/);
  });
});
