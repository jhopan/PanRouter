# AGENTS.md

PanRouter — local AI routing gateway (`/v1/*` OpenAI-compatible) + Next.js dashboard. Plain JavaScript (ESM), **no TypeScript**. `@/*` → `src/*`, `open-sse` → `./open-sse` (jsconfig.json).

## Project identity — PanRouter is the primary project

> **freebucks-proxy: all work happens in ITS OWN repo (`C:\Users\ACER\Documents\Project\freebuff-proxy`, `jhopan/freebucks-proxy` — full `AGENTS.md` with VPS deployment, release-update runbook, dashboard 403 bootstrap, account-injection state). Deploy/update/account-injection/dashboard-admin for freebucks-proxy happens THERE. This repo stays focused on PanRouter — NOTHING outside this project without explicit operator approval.**

**Scope rule (mandatory): work in THIS project only. Do not touch other projects, folders, or repos without explicit approval. References exist to be READ (git fetch + read, port with merit); never push to them, never edit their files, never run mutating commands in them — the only exceptions are `git fetch`/`git merge`/`git push` on the jhopan freebucks-proxy fork itself, which is ours.**

**PanRouter is ours, and it is what we develop, ship, and sell.** Everything in this repo is PanRouter.

### References (read-only sources we sync FROM)

All four are READ-ONLY references — read them, borrow fixes and ideas, never push to any of them. Syncing is optional and judged on merit; PanRouter is the primary project and versions independently.

| Reference | URL | Local checkout | What we take from it |
|---|---|---|---|
| **freebucks-proxy** (fork; dulu `freebuff-proxy`) | https://github.com/jhopan/freebucks-proxy.git | `C:\Users\ACER\Documents\Project\freebuff-proxy` (folder belum direname) | FreeBuff model catalog + agent roots (modelcat), foreign-client gate semantics (foreign_signals), release binary for the VPS bridge, fork changelog + tool-mapping writeup |
| **9router (upstream)** | https://decolua/9router → https://github.com/decolua/9router.git | git remote `upstream` in this repo | Everything engine-side: translators, executors, registry, dashboard |
| **OmniRoute** | https://github.com/diegosouzapw/OmniRoute.git | `C:\Users\ACER\Documents\Project\OmniRoute` | FreeBuff wire lifecycle (executor patterns), provider porting reference (TS) |
| **VansRouter** | https://github.com/Vanszs/VansRouter.git | not checked out | 9router-family router patterns; consult on demand |

### Updating references (how to pull updates into PanRouter)

Prosedur update per referensi — **selalu lewat fork kita (`jhopan/freebucks-proxy`) untuk FreeBuff**, jangan pernah port langsung dari vendor/upstream; referensi lain dibaca saja:

1. **freebucks-proxy (jhopan fork)** — satu-satunya sumber FreeBuff:
   - `git -C Documents/Project/freebuff-proxy pull origin main` — ambil update dari `jhopan/freebucks-proxy` SAJA (fork itu sendiri yang mengurus sinkronisasi vendor; di AGENTS.md ini tidak ada prosedur menyentuh upstream lain).
   - Port yang relevan ke PanRouter: katalog model baru (`registry/freebuff.js`), roots baru (`executors/freebuff.js` `MODEL_TO_AGENT`), perbaikan tool-map (`freebuffToolMap.js`). Perbaikan UI/perf Go fork tidak diport.
   - Contoh 0.0.180 (2026-09-19): +3 model early-access (deepseek-v4.1-flash, deepseek-v4.1-pro, glm-5.3) + tool-map v2.2 dedupe.
2. **9router (upstream)** — `git fetch upstream` di repo ini, baca PR/commit, port yang ber-merit ke kode kita. Jangan merge butir; tidak ada kewajiban mergeable.
3. **OmniRoute** — checkout `Documents/Project/OmniRoute`, `git fetch origin`, baca registry/provider baru (TS), port pola ke JS registry PanRouter.
4. **VansRouter** — shallow-clone on demand saja kalau butuh pola.
Setelah port: verifikasi (`node --check`, vitest file terkait, uji live bila perilaku), commit + push, catat di `CHANGELOG.md`.

Precedence when they disagree: **freebucks-proxy (jhopan fork) > OmniRoute**. The jhopan fork is the ONLY FreeBuff source of truth — its `wirefacts/` snapshots pin the wire version we implement against; if anything disagrees, trust the fork and live wire tests.

- **Upstream `decolua/9router` is a read-only REFERENCE, not a parent to keep parity with.** Read it, borrow ideas and fixes from it, never push to it. Direction of travel is one way: 9router → reference material; PanRouter → development.
- **Version is INDEPENDENT.** PanRouter does NOT track upstream's version number, and is never "behind" or "ahead" in that sense. It versions on its own cadence, driven by our own work (see `CHANGELOG.md`): new providers (FreeBuff, AgentRouter, B.AI), the per-key prepaid token pool, per-provider quota windows, our release pipeline. Bump it when we ship something — that is the whole rule.
- **Syncing from upstream is optional and judged on merit.** Take what helps, skip what doesn't. There is no obligation to stay mergeable and no requirement that any number match theirs.
- **Internal identifiers stay `9router` on purpose** — install paths (`~/.9router`), DB names, salt shapes, package internals. Those are disk/wire compatibility, not branding: existing installs and databases depend on them. Do NOT "fix" them to `panrouter`.
- **What is ours alone** (upstream has none of it): the FreeBuff executor + session pool, the AgentRouter translate layer, per-key prepaid token pools (`apiKeyLimits.js`), per-provider quota windows, router-side parked-quota rows, GitHub-Releases distribution, and the added `tests/unit/` coverage.

Read first:
- `docs/ARCHITECTURE.md` — full system: request lifecycle, combo/account fallback, OAuth + token refresh, cloud sync, data model, env matrix.
- `open-sse/AGENTS.md` — **required before editing anything under `open-sse/`** (translator/executor/provider conventions).
- `tests/translator/AGENTS.md` — translator test conventions, known bugs (`it.fails` list).

This repo deliberately keeps **one** agent-context file: `AGENTS.md` (+ the two nested ones above). There is no `CLAUDE.md` and no second copy to drift out of sync — extend this file instead.

## Commands

```bash
cp .env.example .env            # env contract (JWT_SECRET, INITIAL_PASSWORD, PORT=20128, …)
npm install
npm run dev            # next dev, port 20127 (scripts hardcode it; deploy uses PORT=20128)
npm run build          # next build --webpack
npm run start          # prod: node custom-server.js (port 20127; deploy sets PORT=20128 HOSTNAME=0.0.0.0)
npx eslint .           # lint (eslint.config.mjs, eslint-config-next)

# Bun variants of the same three: dev:bun / build:bun / start:bun
```

CLI package (`cli/`, published separately as `panrouter`; installs and updates pull the tgz from GitHub Releases — see `UPDATER_CONFIG` in `src/shared/constants/config.js`): `npm run cli:pack` from root.

## Tests — non-obvious

`tests/` is an **independent** ESM package, not wired to root `npm test`:

```bash
npm install                  # root deps FIRST (tests import src/ which needs open, undici, …)
cd tests && npm install      # vitest
npx vitest run               # all; auto-discovers tests/vitest.config.js
npx vitest run unit/capabilities.test.js   # single file, path relative to tests/
```

- Ignore `tests/package.json` `test` script — hardcodes Unix `/tmp` paths, broken on Windows. Use `npx vitest` form.
- **Suite is NOT all-green on plain checkout** (≈2450 pass, ≈48 fail). Judge regressions with `tests/__baseline__/verify-no-regression.mjs`, not a raw run. Expected red: `tests/__baseline__/known-fails.txt`, `unit/embeddings.cloud.test.js` (imports `cloud/` dir not in this repo), `unit/xai-oauth-service.test.js` (network timeout), `real/*.real.test.js` (live provider calls, need creds).
- After touching provider registry / alias logic: run `tests/__baseline__/verify-*.mjs` (snapshots committed).
- Translator tests calling `translateRequest`/`translateResponse` MUST `import "./registerAll.js"` — `translator/index.js` uses `require()` which silently no-ops under vitest/ESM → empty registry → false pass.

## Request flow (understand this first)

```
src/app/api/v1/*            (next.config.mjs rewrites /v1/* → /api/v1/*)
  → src/sse/handlers/chat.js        parse, combo expansion, account-selection loop
    → open-sse/handlers/chatCore.js  detect source format, translate request,
                                       dispatch to executor, retry/refresh, stream setup
      → open-sse/executors/*         per-provider upstream call (default.js = any OpenAI-compatible)
      → open-sse/translator/*        client format ↔ provider format
        → SSE back to client
```

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (usable standalone in principle — but see `open-sse/AGENTS.md`, it is not actually decoupled: ~14 files reach back into `src/`). Cross that boundary consciously.

## Translators, registry, persistence

- **Translator engine** pivots through **OpenAI as the intermediate format**. A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop — prefer one for fragile pairs (thinking blocks, tool ids, non-base64 images, `is_error`).
- **Provider registry**: one file per provider; `providers/registry/index.js` is auto-generated (see Gotchas). Add a provider by copying `providers/REGISTRY_TEMPLATE.js` + adding models to `config/providerModels.js`; only non-OpenAI-compatible upstreams need an executor.
- **Persistence is SQLite, not `db.json`** (ARCHITECTURE.md is stale on this). `src/lib/db/` with an adapter fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3` (optional native dep, deliberately, so install never needs build tools) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS, always works); `src/lib/localDb.js` is a backward-compat shim re-exporting `@/lib/db/index.js` — new code imports the latter, per-entity logic lives in `src/lib/db/repos/*`. DB path resolves via `src/lib/db/paths.js` (`DATA_DIR`, else `~/.9router/`). Usage/logs (`src/lib/usageDb.js`, `usage.json` + `log.txt`) still live under `~/.9router` and do **not** follow `DATA_DIR`.
- **RTK token saver** (`open-sse/rtk/`) compresses `tool_result` content in place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of a hook. It skips `is_error` / `status:"error"` results to preserve traces.

## Gotchas

- New translator file MUST be imported in `open-sse/translator/index.js` (self-registration via import side effect) or it never runs.
- `open-sse/providers/registry/index.js` is **auto-generated** — regenerate with `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`, never hand-edit.
- `custom-server.js` derives client IP from TCP socket and strips untrusted `X-Forwarded-For` (trusts forwarding headers only from loopback proxy). Preserve when touching request/IP/rate-limit code.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) are handled inside their executors, not the translator.
- Security env: `JWT_SECRET`, `INITIAL_PASSWORD` (default `123456`, must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Contract in `.env.example`.
- **A request body must not carry a backtick-quoted `curl`/`wget` command when the upstream sits behind a WAF.** Render serves every public web service behind Cloudflare's managed web application firewall, which inspects the **body** and rejects that pattern — it reads the Markdown inline-code span as command-injection/SSRF (the block page says *"Your request was blocked by this site's web application firewall (WAF)"*). One such line anywhere in a conversation (a skill file, an `AGENTS.md`, a tool result) blocks **every** request in that session, and fixing the source file does not recover the session, because the text is already in the message history. `open-sse/config/wafGuard.js` plus one retry in `open-sse/executors/base.js` handle it, scoped to the hosts in `WAF_PROTECTED_HOSTS`. Documented for users in the README Troubleshooting section.
  - **When you meet this, do not chase the proxy.** It is not the proxy pool and not the egress IP: the block reproduces with no proxy at all, and the shared `vercel-relay` pool is used by unrelated providers too. The WAF is not configurable (Render: *"There's nothing to configure"*) and runs at the edge, so IP allowlists do not bypass it. To find the cause, bisect which message carries the pattern — `messages[0]` alone reproduces it (the request dumps under the Hermes profile's `sessions/` directory hold the exact body).
  - Only the `curl`/`wget` form is neutralised. A new signature means new work, not a tweak to the existing list.

## Conventions

- Conventional Commits (`fix(translator): …`). Root and `cli/` are versioned independently of each other **and of upstream** (see Project identity); log changes in `CHANGELOG.md`.
- Config-driven: never hardcode provider/model/role/block strings — use `open-sse/config/` + `open-sse/translator/schema/` constants.
- **Always run `npm run dev` for live testing.** Unit tests and `npm run build` alone are not verification — for any behavioral change (executor, translator, auth, dashboard), start the dev server (`npm run dev`, port 20127) and exercise the changed path with real requests before claiming it works. Kill the dev server before `next build` (they share `.next`), and verify the port is actually free (`netstat` empty for 20127): a half-dead dev server corrupts the build's `.next` and surfaces as `Jest worker encountered ... child process exceptions` when a page is opened.
- **Explain-only requests are read-only.** When the operator asks to explain something (`coba jelaskan`, `jelasin aja dulu`, `jelaskan dulu`), answer the question — do not modify files, configs, tests, or remote state, and do not run mutating commands. Changes happen only on an explicit follow-up instruction.

### Releases (mandatory)

- **When the operator says "release" / "rilis", it means publish a GitHub Release on `jhopan/PanRouter` — nothing else.** Not an npm publish (this repo does not publish to the registry), not a local build, not a tag alone.
- The whole flow, in order:
  1. Bump the version in **both** `package.json` and `cli/package.json` (they move together), and add a top entry to `CHANGELOG.md`.
  2. `npm run build` to prove it compiles. Stop the dev server first — `next build` and `next dev` share `.next`.
  3. Commit + push `master`.
  4. `git tag -a vX.Y.Z` and **push the tag**. The tag is what triggers CI; nothing is published from the local machine.
  5. `.github/workflows/release.yml` then runs on `ubuntu-latest`: `npm run cli:pack`, and `gh release create` for **two** releases — the versioned one (`vX.Y.Z`) and a `latest` release whose tag is force-moved to the same commit, carrying `panrouter-latest.tgz` for the stable install URL.
- **Never upload the package by hand.** `*.tgz` is gitignored for exactly this reason — CI builds the artifact. Do not commit one.
- **Verify after the run finishes**, do not trust a green status alone: `gh release view vX.Y.Z --json assets` for both releases, then confirm the documented URL actually serves the new version (`package/package.json` inside the tgz).
- **Deploying to a remote server is NOT part of a release.** Updating neva (or anything else) stays a separate, explicitly-authorized action — see Remote servers above.

### Git workflow (mandatory)

- **Commit + push every change** immediately (`git add -A && git commit -m "…" && git push`) so any error can be reverted (git reset/revert) and other machines can `git pull`.
- **Always make commits through the `git-commit` skill** (`skill_view(name='git-commit')`) — do not hand-roll the message. It dictates the analysis step (read the actual diff, not the intent), Conventional Commits formatting, the type/scope table, and the git safety protocol. Every commit in this repo follows Conventional Commits (`fix(translator): …`); the skill is how that stays true.
- Convention follows from the above: `<type>[scope]: <description>`, imperative mood, description under 72 chars, one logical change per commit, body explains *why*. Never commit secrets (`.env`, credential files) and never commit build artifacts (`*.tgz` is gitignored for this reason — CI builds the release package).
- Before a risky change: make sure working tree is clean so a broken edit can be rolled back with `git checkout .`.
- Push to **our** repo `jhopan/PanRouter` — the primary project. Never push to upstream `decolua/9router`; it is a read-only reference (see Project identity above).

### Remote servers (mandatory)

- **NEVER modify anything on remote servers (VPS neva, Render dashboard config, etc.) — local edits only.** No crontab changes, no config edits, no file writes, no service restarts on remotes unless the user explicitly asks for THAT exact change first. Investigation/read-only SSH is fine; mutation is not.

### AgentRouter (provider + translate layer)

- Provider: `agentrouter` — Anthropic-compatible relay, baseUrl `https://agentrouter.org/v1/messages`, auth `x-api-key`, aliases `AR`/`ar`. Model prefix `AR/<model>`.
- Translate-in (`open-sse/translator/concerns/agentrouterTranslate.js`) runs in `chatCore.js` before dispatch — translates user turns ID→EN. Translate-out (`agentrouterResponseTranslate.js`) runs in `chatCore/streamingHandler.js` — translates response EN→ID, strips preamble, pass-through tool_use/tool_result.
- **Both are fail-open** — a translate error must never break the request. Only for `provider === "agentrouter"`; guard keeps other providers untouched.
- Translate uses the local `translate` combo (self-invoke `/v1/chat/completions` with a key from `getApiKeys`). AgentRouter only accepts Mandarin/English/French/German/Russian.
- **AgentRouter rejects synthetic `type:"custom"` tool objects** — `chatCore.js` skips `defaultClaudeToolType` for this provider; `default.js` also strips first-party Claude-CLI beta headers for it (see skill 9router-development for the full story).
- Streaming gate: body MUST carry `stream:true` or the upstream answers `text/plain` non-SSE and PanRouter blocks it (`upstream non-SSE: 200`).

### FreeBuff (native provider — Codebuff free-tier models)

- Provider: `freebuff` — aliases `fb`/`FB`/`freebuff`. baseUrl `https://www.codebuff.com/api/v1/chat/completions` (OpenAI shape). Models: `deepseek/deepseek-v4-flash`, `z-ai/glm-5.3-flash`, `mimo/mimo-v2.5`, `openai/gpt-5.6-luna`, `minimax/minimax-m3` (+ passthrough). Full detail: `docs/plans/2026-09-04-freebuff-provider.md` and skill `9router-development`.
- **Dual auth**: browser login (OAuth device-polling — `src/lib/oauth/providers/freebuff.js`, `flowType: "device_code"`, no callback URL; fingerprint `enhanced-<43b64url>` binds the poll so login can happen on ANY device) OR paste token (CLI `authToken` from `~/.config/manicode/credentials.json`; grab with `scripts/kiro-token-grab.mjs` style — actually FreeBuff: read that file's `default.authToken`).
- **Executor** (`open-sse/executors/freebuff.js`) — ported from OmniRoute + upgraded with freebuff-proxy techniques. Non-obvious:
  - **Session pool is per `token::model`** — upstream binds one session to one model; switching models on the same session = `409 session is bound to X`.
  - `409` handling: first 409 → honest rotate (FINISH) + re-handshake + retry once; second 409 = account-level conflict ("another instance taken over" — a stale server-side instance, e.g. from the standalone freebuff-proxy era, still holds the account).
  - `429` → in-memory token cooldown + structured error → PanRouter account-fallback switches to the next FreeBuff connection automatically (drain, **never round-robin** — farm-detection).
  - Honest run lifecycle: START once per session, FINISH only on rotate/403; stable 13-char base36 client_id from machine hash; per-endpoint UA (`Bun/1.3.14` session, `ai-sdk/.../codebuff` chat); handshake jitter ±200ms.
- **Region reality**: Indonesian egress = `accessTier: limited` — `glm-5.3-flash`/`luna` are coerced/blocked (`country_not_allowed`), but **`deepseek-v4-flash` + `mimo-v2.5` serve 200** with 6 quota sessions/day each (reset Pacific midnight = 07:00 WIB). 1 quota session = a 1-hour admission block (all chats inside it share the claim) — session pooling is what keeps usage inside one claim.
- Old chat payload from a previous model can poison the session — if a request 409s twice in a row, wait for the server-side instance to expire (~1h) or re-login.

### Kiro (token import + suspension triage)

- Token sources: Kiro IDE → `~/.aws/sso/cache/kiro-auth-token.json` (auto-imported by `KiroAuthModal`); Kiro CLI → `%LOCALAPPDATA%/Kiro-Cli/data.sqlite3` → `auth_kv["kirocli:social:token"]` (snake_case fields). Grabber: `scripts/kiro-token-grab.mjs` (`--print` pipes the refresh token; CLI first via builtin `node:sqlite`, better-sqlite3 fallback, IDE last).
- Suspension triage: `invalid_grant` refresh spam = dead refresh token (re-login fixes). `403 "User ID temporarily suspended"` with a SUCCESSFUL refresh = account-level API lock (re-login does NOT fix — swap account or wait).
- `KiroAuthModal` also has "From Kiro CLI"/"From Kiro IDE" buttons that reveal OS-aware one-line grab commands for remote servers (PowerShell `curl.exe`+`;`, bash `&&`).

### B.AI (provider)

- `bai`/`BAI` alias, OpenAI-compatible `https://api.b.ai/v1/chat/completions`, Bearer key. Catalog auto-arrives once a connection exists (`BAI/glm-5.3-flash` etc.). Credit-based — `insufficient_user_quota` means top-up. Caps (vision/reasoning) resolve via the standard 4-layer capabilities lookup.

### Agnes AI (provider, v0.5.75.15)

- `agnes` alias, apikey, `https://apihub.agnes-ai.com/v1/chat/completions`, Bearer key. **Recurring-uncapped free tier** (permanen free, rate-limit saja — 20 RPM teks, tanpa kartu kredit). Key dari `platform.agnes-ai.com`. Models: `agnes-1.5/2.0/2.5` Flash (262k–512k ctx, vision, tool calling). One-time-initial vs recurring budget: Agnes = recurring.

### FreeModel.dev (provider, v0.5.75.15)

- `fmd` alias (aliases `freemodel`), apikey, `https://api.freemodel.dev/v1/chat/completions`, Bearer key. **One-time-initial** budget (kredit awal gratis, habis = habis, tidak reset — untuk eksperimen, bukan beban rutin). Live `/v1/models` exposes `gpt-5.6-luna/sol/terra`; pinned alongside OmniRoute 5.x rows (`gpt-5.5/5.4/5.4-mini/5.3-codex` etc.).

### OrcaRouter (provider, v0.5.75.15)

- `orca` alias (aliases `orcarouter`), apikey, **Responses API** `https://api.orcarouter.ai/v1/responses` (bukan chat/completions), Bearer token. Key dari `orcarouter.ai/console/token`. Free pins: `deepseek/deepseek-v4-flash-free`, `tencent/hy3-free`, `z-ai/glm-5.3-flash-free`, `orca/orcaverify-text1.0-free`. Katalog terbuka tanpa key (197 model) — `passthroughModels` aktif. Kalau nanti butuh bentuk chat/completions klasik, tambah transport kedua di registry (pola opencode-go).

### APInex (provider, v0.5.75.15)

- `apinex` alias (aliases `apn`), apikey, `https://api.apinex.bond/v1/chat/completions`, Bearer key. Key dari `apinex.bond/keys`. Free models pakai prefix vendor `free/` — pin `free/glm-5.3-flash`, sisanya via passthrough.

### TokenHarbor (provider, v0.5.75.15)

- `th` alias (aliases `tokenharbor`), apikey, `https://tokenharbor.ai/v1/chat/completions`, Bearer key. Key dari `tokenharbor.ai/dashboard/api-keys`. Free models pakai suffix `:free` — pins: `deepseek-v4.1-flash:free`, `deepseek-v4-flash:free`, `mimo-v2.5:free`; paid models via passthrough.





### 📊 Resource sizing (measured)

# PanRouter resource sizing (measured on vps-natusa, 1 GB RAM)

## Current usage (idle, 1 user, uptime 4+ days)

| Process | RSS | Note |
|---|---|---|
| `node /usr/bin/panrouter` (CLI launcher) | 4.7 MB + 12.9 MB in swap | parent, mostly swapped out |
| `next-server (v16.3.5)` (SSR worker) | **~115 MB** | the real consumer |
| **PanRouter total** | **~120 MB** | |

Context on the same box: PanDrive 12.5 MB, cloudflared 23 MB, system ~90 MB.

## Why so big

Next.js runs **server-side rendering** — every page hit is rendered in Node. Baseline RSS of a
production Next server is 80-120 MB regardless of traffic; concurrency multiplies render workers.

## Per-user scaling (rough)

| Concurrent users | Expected RSS |
|---|---|
| 1-5 (idle/light) | 120-150 MB |
| 10-20 active | 200-300 MB |
| 50+ | 400-600 MB (or scale out) |

Node's GC lets heap grow before collecting, so RSS creeps under load — cap it.

## Recommendations (apply in this order)

1. **Cap the heap**: run with `NODE_OPTIONS="--max-old-space-size=256"` (256 MB cap for a 1 GB box).
   Without it Node can balloon to the OOM killer under spikes.
2. **Process manager with memory limit**: pm2 (`pm2 start panrouter --max-memory-restart 300M`) or a
   systemd `MemoryMax=300M` unit — auto-restart instead of OOM-kill.
3. **Static where possible**: pages that need no per-request server data can be `output: 'export'`
   (then any static file server uses ~10-20 MB instead of 120+).
4. **1 GB box ceiling**: PanRouter (~120) + PanDrive (~13) + cloudflared (~23) + system (~90) ≈ 250 MB
   base → fits today, but 20+ concurrent PanRouter users need either the heap cap or a 2 GB box.
