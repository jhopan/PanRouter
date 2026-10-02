<div align="center">

# PanRouter

**Local AI routing gateway — OpenAI-compatible `/v1/*` API + Next.js dashboard**

*Route ke 20+ provider AI, fallback otomatis, hemat token, zero downtime.*

[![Release](https://img.shields.io/github/v/release/jhopan/PanRouter?logo=github)](https://github.com/jhopan/PanRouter/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

*Maintained by [jhopanstore](https://github.com/jhopan)*

</div>

---

## Apa itu PanRouter?

PanRouter adalah proxy lokal yang duduk di antara CLI tool AI kamu (Claude Code, Codex, Cursor, Cline...) dan provider upstream. Kamu cukup arahkan tool ke `http://localhost:20128/v1` — PanRouter yang urus sisanya:

- **Fallback otomatis** — quota habis di provider A → langsung ke provider B, tanpa kamu sadari
- **RTK Token Saver** — kompres output tool (`git diff`, `grep`, `ls`...) sebelum dikirim ke LLM, hemat 20–40% input token
- **Caveman Mode** — inject prompt terse, hemat hingga 65% output token
- **Multi-akun per provider** — auto round-robin / priority drain
- **Quota tracking** — pantau sisa quota, countdown reset, per provider dan per akun
- **Auto token refresh** — OAuth token diperbarui otomatis sebelum expired
- **Dashboard Next.js** — UI untuk tambah koneksi, buat combo, pantau usage

---

## Quick Start

```bash
npm install -g https://github.com/jhopan/PanRouter/releases/latest/download/panrouter-latest.tgz
panrouter
```

Dashboard buka di `http://localhost:20128`.

Arahkan CLI tool ke:
```
Endpoint : http://localhost:20128/v1
API Key  : [salin dari dashboard]
```

Atau jalankan dari source:

```bash
cp .env.example .env
npm install
npm run dev        # dev server, port 20127
```

---

## Provider yang Didukung

### OAuth (login browser)

| Provider | Alias | Model unggulan |
|---|---|---|
| Claude Code | `cc` | claude-opus-4-7, claude-sonnet-4-6 |
| OpenAI Codex | `cx` | gpt-6.1-sol, gpt-5.6-luna, gpt-5.5 |
| GitHub Copilot | `gh` | claude-opus-4.7, gpt-5.4, gemini-3.1-pro |
| Cursor | `cu` | claude-opus-max, gpt-5.3-codex |
| Kiro AI | `kr` | claude-sonnet-4.5, glm-5, minimax |
| Antigravity | `ag` | gemini + claude via Google Cloud Code Assist |
| FreeBuff | `fb` | deepseek-v4-flash, mimo-v2.5 |
| Qoder | `qd` | Qwen3.8-Flash (Free) |
| CodeBuddy Intl | `cbai` | gpt-6-astra, deepseek-v4.1-flash, gemini-3.5-flash |
| Grok CLI | `gk` | grok-4.5-high |
| AgentRouter | `ar` / `AR` | claude + model lain via relay |

### API Key

| Provider | Alias | Keterangan |
|---|---|---|
| B.AI | `bai` | OpenAI-compatible, kredit |
| Agnes AI | `agnes` | Free recurring 20 RPM, agnes-1.5/2.0/2.5 |
| FreeModel.dev | `fmd` | Kredit awal gratis, gpt-5.6-luna/sol/terra |
| OrcaRouter | `orca` | Responses API, free pins deepseek/glm/hy3 |
| APInex | `apn` | free/glm-5.3-flash + passthrough |
| TokenHarbor | `th` | `:free` suffix, 7-hari rolling quota |
| VYCEAI | `vy` | qwen3.8-flash, deepseek-v4-flash, claude-sonnet-4-6 |
| APIMIX.AI | `am` | space-bunny-free, deepseek-v4-flash-free |
| Atria Dawn | `at` | Atria-Dawn-Preview, dual endpoint (chat + responses) |
| JustDoWork | `jd` | claude-opus-4-8, Anthropic-compatible |
| + 30 lainnya | — | OpenRouter, GLM, Kimi, MiniMax, DeepSeek, Groq, Mistral, Gemini, xAI, Ollama, ... |

---

## Fitur Unggulan

### RTK Token Saver
Kompres `tool_result` content (`git diff`, `grep`, `ls`, `tree`...) sebelum dikirim ke LLM. Auto-detect format, fail-open (error tidak merusak request). Hemat 20–40% input token per request.

### Caveman Mode
Inject system prompt "caveman-speak" — LLM balas ringkas tanpa basa-basi. Hemat hingga 65% output token. Dipakai Hermes + jhopanstore sendiri.

### Ponytail (Lazy Senior Dev)
Inject prompt YAGNI-first — LLM tulis kode minimal, no unrequested abstraction. Tiga level: Lite / Full / Ultra.

### Quota Auto-Ping
- **Codex** — ping otomatis saat window 5 jam reset, buka window baru
- **CodeBuddy Intl** — daily check-in sekali sehari jam acak (08:00–20:00 WIB), model `fast-model`
- **FreeBuff** — daily streak keeper, sekali per hari per akun

### Antigravity Weekly Bucket
Akun Antigravity punya dua bucket terpisah: `gemini_weekly` dan `claude_gpt_weekly`. PanRouter skip akun berdasarkan bucket — kalau Gemini habis, request Claude tetap masuk ke akun yang sama.

### Qoder Device-Token Refresh
Token Qoder (`dt-...`) diperbarui otomatis via `/api/v1/deviceToken/refresh` (wire-verified dari qodercli 1.1.64). Token hidup ~30 hari, refresh 3 hari sebelum expired.

### Smart Combo & Fallback
Buat combo model dengan fallback otomatis:
```
combo: all-in
  1. cc/claude-opus-4-7    ← subscription utama
  2. ag/gemini-flash        ← gratis via Antigravity
  3. cb/fast-model          ← CodeBuddy backup
  4. fb/deepseek-v4-flash   ← FreeBuff daily quota
```

---

## Hal Baru di PanRouter (vs 9router)

| Fitur | Status |
|---|---|
| FreeBuff executor (Codebuff free models) | ✅ Original |
| AgentRouter translate layer (ID↔EN auto) | ✅ Original |
| Per-key prepaid token pools | ✅ Original |
| Per-provider quota windows + auto-parking | ✅ Original |
| CodeBuddy Intl daily auto-ping | ✅ Original |
| Antigravity weekly bucket routing | ✅ Original |
| Qoder device-token refresh | ✅ Original |
| Agnes AI / FreeModel.dev / OrcaRouter / APInex | ✅ Original |
| TokenHarbor 7-hari rolling quota park | ✅ Original |
| VYCEAI / APIMIX.AI / Atria Dawn / JustDoWork | ✅ Original |
| Cline marketplace hidden (registry-pinned only) | ✅ Original |
| Live model fetch disabled di /v1/models | ✅ Original |
| GitHub Releases distribution (CLI auto-update) | ✅ Original |

---

## Install & Update

**Install:**
```bash
npm install -g https://github.com/jhopan/PanRouter/releases/latest/download/panrouter-latest.tgz
```

**Update:**
```bash
panrouter update
```

**Versi spesifik:**
```bash
npm install -g https://github.com/jhopan/PanRouter/releases/download/vX.Y.Z/panrouter-vX.Y.Z.tgz
```

---

## Deployment

### VPS / Server

```bash
git clone https://github.com/jhopan/PanRouter.git
cd PanRouter
npm install && npm run build
PORT=20128 HOSTNAME=0.0.0.0 JWT_SECRET=ganti-ini INITIAL_PASSWORD=ganti-ini npm run start
```

### Docker

```bash
cp .env.example .env   # isi JWT_SECRET dan INITIAL_PASSWORD
docker build -t panrouter .
docker run -d -p 20128:20128 --env-file .env -v panrouter-data:/root/.9router panrouter
```

### Environment Variables

| Variabel | Default | Keterangan |
|---|---|---|
| `JWT_SECRET` | auto-generated | Secret JWT untuk auth cookie |
| `INITIAL_PASSWORD` | `123456` | Password login pertama |
| `DATA_DIR` | `~/.9router` | Lokasi SQLite (`$DATA_DIR/db/data.sqlite`) |
| `PORT` | 3000 | Port server |
| `HOSTNAME` | localhost | Bind host |
| `API_KEY_SECRET` | default | HMAC secret untuk API key |
| `ENABLE_REQUEST_LOGS` | false | Log full request/response ke `logs/` |
| `REQUIRE_API_KEY` | false | Wajib Bearer key di `/v1/*` |

---

## Troubleshooting

**503 WAF Block** — body mengandung backtick+curl+URL, diblok Cloudflare WAF upstream. PanRouter v0.5.75.10+ handle otomatis (strip inline-code marker, retry sekali). Mulai session baru kalau pattern sudah masuk history.

**Quota exhausted** — cek dashboard quota tracker. Buat combo dengan fallback ke provider lain.

**Token expired** — OAuth diperbarui otomatis. Kalau tetap gagal: Dashboard → Provider → Reconnect.

**Port conflict** — set `PORT=20128` di `.env`.

---

## Tech Stack

- **Runtime**: Node.js 22+
- **Framework**: Next.js 16 (Turbopack)
- **UI**: React 19 + Tailwind CSS 4
- **Database**: SQLite — driver fallback: `bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js`
- **Streaming**: Server-Sent Events (SSE)
- **Auth**: OAuth 2.0 (PKCE) + JWT + API Keys

---

## Credits & Acknowledgments

- **[decolua/9router](https://github.com/decolua/9router)** — referensi arsitektur engine, translator pipeline, dan provider registry. PanRouter berdiri sendiri (standalone, bukan fork) dan versioning independen.
- **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — referensi executor patterns untuk FreeBuff dan porting provider (TypeScript).
- **[RTK](https://github.com/rtk-ai/rtk)** — token saver pipeline yang diport ke JS.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** — prompt terse yang diadaptasi untuk Caveman Mode.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** — lazy senior dev skill yang diadaptasi.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
  <sub>Maintained by <a href="https://github.com/jhopan">jhopanstore</a> &nbsp;•&nbsp; Built for developers who code 24/7</sub>
</div>
