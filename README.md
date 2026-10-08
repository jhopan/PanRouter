<div align="center">

<img src="./images/9router.png" alt="PanRouter" width="700"/>

# PanRouter

**Local AI routing gateway — OpenAI-compatible `/v1/*` + Next.js dashboard**

[![Release](https://img.shields.io/github/v/release/jhopan/PanRouter?label=latest&logo=github)](https://github.com/jhopan/PanRouter/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)
[![Maintained by](https://img.shields.io/badge/maintained%20by-jhopanstore-informational)](https://github.com/jhopan)

[Quick Start](#quick-start) · [Providers](#providers) · [Features](#features) · [Deploy](#deployment) · [Releases](https://github.com/jhopan/PanRouter/releases)

</div>

---

PanRouter adalah proxy lokal yang duduk di antara AI coding tool kamu dan provider upstream. Arahkan tool ke `http://localhost:20128/v1`, PanRouter urus sisanya — fallback otomatis, token saving, quota tracking, multi-akun.

```
Claude Code / Codex / Cursor / Cline / OpenCode
            │
            ▼  http://localhost:20128/v1
      ┌─────────────────────┐
      │      PanRouter      │
      │  • RTK Token Saver  │
      │  • Format translate │
      │  • Quota tracking   │
      │  • Auto fallback    │
      └──────┬──────────────┘
             │
     ┌───────┼───────────────┐
     ▼       ▼               ▼
  Claude   Codex   Kiro / FreeBuff / Antigravity / ...
```

---

## Quick Start

**Install:**
```bash
npm install -g https://github.com/jhopan/PanRouter/releases/latest/download/panrouter-latest.tgz
panrouter
```

**Update:**
```bash
panrouter update
# atau lewat menu interaktif saat startup
```

Dashboard buka di [`http://localhost:20128`](http://localhost:20128). Salin API key, arahkan CLI tool:

```
Endpoint : http://localhost:20128/v1
API Key  : (salin dari dashboard)
Model    : cc/claude-opus-4-7   # atau combo apapun
```

**Dari source:**
```bash
cp .env.example .env && npm install
npm run dev    # port 20127
```

---

## Providers

### OAuth (login browser)

| Provider | Alias | Model |
|---|---|---|
| Claude Code | `cc` | claude-opus-4-7, claude-sonnet-4-6, claude-sonnet-5-5 |
| OpenAI Codex | `cx` | gpt-6.1-sol, gpt-5.6-luna/terra/sol, gpt-5.5 |
| GitHub Copilot | `gh` | claude, gpt-5.4, gemini-3.1-pro |
| Cursor | `cu` | claude-opus-max, gpt-5.3-codex |
| Antigravity | `ag` | gemini + claude (Google Cloud Code Assist) |
| Kiro AI | `kr` | claude-sonnet-4.5, glm-5, minimax |
| FreeBuff | `fb` | deepseek-v4-flash, mimo-v2.5 |
| Qoder | `qd` | Qwen3.8-Flash (Free) |
| CodeBuddy Intl | `cbai` | gpt-6-astra, deepseek-v4.1-flash, gemini-3.5-flash, kimi-k2.8 |
| Grok CLI | `gk` | grok-4.5-high |
| AgentRouter | `ar` | claude + multi-model relay |

### API Key

| Provider | Alias | Keterangan |
|---|---|---|
| Agnes AI | `agnes` | Free recurring 20 RPM, agnes-1.5/2.0/2.5 Flash |
| B.AI | `bai` | Credit-based, GLM + multi-model |
| FreeModel.dev | `fmd` | Kredit awal gratis, gpt-5.6-luna/sol/terra |
| OrcaRouter | `orca` | Responses API, free deepseek/glm/hy3 |
| TokenHarbor | `th` | 7-hari rolling quota, `:free` suffix |
| VYCEAI | `vy` | qwen3.8-flash, deepseek-v4-flash, claude-sonnet-4-6 |
| APIMIX.AI | `am` | space-bunny-free, deepseek-v4-flash-free |
| Atria Dawn | `at` | Atria-Dawn-Preview, dual endpoint (chat + responses) |
| JustDoWork | `jd` | claude-opus-4-8, Anthropic-compatible |
| APInex | `apn` | free/glm-5.3-flash + passthrough |
| + 30 lainnya | — | OpenRouter, GLM, Kimi, MiniMax, DeepSeek, Groq, Mistral, xAI, Gemini, Ollama... |

---

## Features

### 🗜️ RTK Token Saver
Kompres `tool_result` (`git diff`, `grep`, `ls`, `tree`...) sebelum dikirim ke LLM. Auto-detect format, fail-open. **Hemat 20–40% input token.**

### 🗿 Caveman Mode
Inject system prompt ringkas — LLM balas tanpa basa-basi. **Hemat hingga 65% output token.** *(adapted from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman))*

### 🐴 Ponytail
Inject prompt YAGNI-first — LLM tulis kode minimal. Lite / Full / Ultra. *(adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail))*

### 🔄 Smart Fallback & Combo
```
combo: all-in
  1. cc/claude-opus-4-7     ← subscription utama
  2. ag/gemini-flash         ← gratis Antigravity
  3. cbai/fast-model         ← CodeBuddy backup
  4. fb/deepseek-v4-flash    ← FreeBuff daily
```
Quota habis di satu → lanjut ke berikutnya otomatis.

### 📊 Quota Tracking & Auto-Parking
- Reset countdown per provider dan akun
- `modelLock` otomatis saat quota habis, buka saat reset
- Antigravity: dua bucket terpisah — `gemini_weekly` dan `claude_gpt_weekly`, routing berdasarkan bucket bukan per-model

### 🔔 Auto-Ping Schedulers
| Provider | Mekanisme |
|---|---|
| Codex | Ping saat window 5 jam reset, buka window baru |
| CodeBuddy Intl | Daily check-in jam acak 08:00–20:00 WIB, model `fast-model` |
| FreeBuff | Daily streak keeper, sekali per hari per akun |

### 🔑 Token Refresh
- OAuth token diperbarui otomatis sebelum expired
- Codex: `refreshLeadMs` 10 menit — cegah refresh-token reuse yang logout akun
- Qoder: device-token refresh via `/api/v1/deviceToken/refresh` (wire-verified dari qodercli 1.1.64)

---

## Apa yang Beda dari 9router?

| Fitur | PanRouter |
|---|---|
| FreeBuff executor (Codebuff free models) | ✅ |
| AgentRouter translate layer (ID↔EN auto) | ✅ |
| Per-key prepaid token pools | ✅ |
| Per-provider quota windows + auto-parking | ✅ |
| CodeBuddy Intl daily auto-ping | ✅ |
| Antigravity weekly bucket routing (Gemini / Claude+GPT) | ✅ |
| Qoder device-token refresh | ✅ |
| Agnes / FreeModel / OrcaRouter / APInex | ✅ |
| TokenHarbor 7-hari rolling quota | ✅ |
| VYCEAI / APIMIX / Atria Dawn / JustDoWork | ✅ |
| Cline marketplace disembunyikan (registry-pinned only) | ✅ |
| Live model fetch disabled di `/v1/models` | ✅ |
| GitHub Releases distribution + CLI auto-update | ✅ |

---

## Deployment

### VPS

```bash
git clone https://github.com/jhopan/PanRouter.git && cd PanRouter
npm install && npm run build
PORT=20128 HOSTNAME=0.0.0.0 JWT_SECRET=ubah-ini INITIAL_PASSWORD=ubah-ini npm run start
```

### Docker

```bash
cp .env.example .env
docker build -t panrouter .
docker run -d -p 20128:20128 --env-file .env -v panrouter-data:/root/.9router panrouter
```

### Environment Variables

| Variabel | Default | Keterangan |
|---|---|---|
| `JWT_SECRET` | auto-generated | Secret JWT auth cookie |
| `INITIAL_PASSWORD` | `123456` | Password login pertama (wajib diganti) |
| `DATA_DIR` | `~/.9router` | Lokasi SQLite |
| `PORT` | 3000 | Port server |
| `HOSTNAME` | localhost | Bind host (set `0.0.0.0` untuk VPS) |
| `API_KEY_SECRET` | default | HMAC secret API key |
| `ENABLE_REQUEST_LOGS` | false | Log request/response ke `logs/` |
| `REQUIRE_API_KEY` | false | Wajib Bearer key di `/v1/*` |

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| **503 WAF Block** | Body mengandung backtick+curl+URL — PanRouter v0.5.75.10+ handle otomatis. Mulai session baru kalau sudah masuk history. |
| **Quota exhausted** | Cek dashboard quota tracker. Tambah provider lain ke combo. |
| **Token expired** | OAuth diperbarui otomatis. Kalau tetap gagal: Dashboard → Provider → Reconnect. |
| **Port conflict** | Set `PORT=20128` di `.env` |
| **`model_config` not known** | Qoder: jalankan list model fetch sekali dari dashboard sebelum chat |

---

## Tech Stack

| | |
|---|---|
| Runtime | Node.js 22+ |
| Framework | Next.js 16 (Turbopack dev / webpack prod) |
| UI | React 19 + Tailwind CSS 4 |
| Database | SQLite — `bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js` |
| Streaming | Server-Sent Events (SSE) |
| Auth | OAuth 2.0 (PKCE) + JWT + API Keys |

---

## Credits

- **[decolua/9router](https://github.com/decolua/9router)** — referensi arsitektur engine, translator pipeline, provider registry. PanRouter standalone dan versioning independen.
- **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — referensi executor pattern FreeBuff (TypeScript).
- **[RTK](https://github.com/rtk-ai/rtk)** — token compression pipeline.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** — terse prompt adapted untuk Caveman Mode.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** — YAGNI-first prompt adapted.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
  <sub>Maintained by <a href="https://github.com/jhopan">jhopanstore</a> · Built for developers who code 24/7</sub>
</div>
