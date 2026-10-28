# v0.5.88.17 (2026-10-27)

## Perbaikan

- **Perintah mirror sekarang memakai URL lengkap dan tetap satu perintah saat
  di-paste.** Dua masalah, ketemu saat melihat halaman yang sudah dirender:

  1. URL-nya relatif (`/api/backup/download`) karena origin dibaca dari window
     saat render. Sekarang origin disimpan di state yang awalnya kosong —
     `useEffect` tidak pernah jalan di render server, jadi render client pertama
     juga kosong dan HTML-nya cocok (tidak ada hydration mismatch) — dan terisi
     tepat setelah mount.

  2. Perintah curl satu baris tidak punya line continuation shell, jadi
     di-paste baris pertama jalan sebagai perintah lengkap dan baris kedua
     sebagai perintah lain. Kedua perintah sekarang diakhiri backslash, dibangun
     dari `String.fromCharCode(92)` supaya backslash-nya tetap backslash, bukan
     berubah jadi escape JS.

  Diverifikasi di browser terhadap production build: kelima blok melaporkan
  `literalN false`, tiga blok perintah membawa URL absolut, jumlah baris sesuai
  (3/3/4/1/9), dan tidak ada yang meluber keluar kotaknya.

## Test

- 40 test `db-backup-service.test.js`.
- Suite: **3200 lulus**, 0 regresi baru.

# v0.5.88.16 (2026-10-27)

## Perbaikan

- **Blok perintah di dashboard sekarang bisa langsung disalin, dan teksnya
  tidak lagi `
` literal.**

  Panel sebelumnya menampilkan dua karakterbackslash + n, bukan line break:
  string perintahnya digabung dengan `" \n"` (backslash dan huruf n), dan
  backslash continuation shell-nya ikut kacau oleh escaping JS. Hasilnya satu
  baris panjang dengan `
` di tengah dan teks meluber keluar kotak kode.

  Sekarang setiap blok perintah lewat komponen bersama `CopyableCode`:

  - dirender di `<pre>` dengan `whitespace-pre-wrap` + `break-words`, jadi
    newline asli tampil dan tidak ada yang meluber
  - ada tombol copy di samping setiap blok yang menaruh **teks yang sama
    persis** ke clipboard, siap paste ke shell
  - backslash continuation shell dibangun dari `String.fromCharCode(92)` supaya
    backslash-nya tetap backslash, bukan escape

  Diverifikasi di browser terhadap dev server yang jalan: kelima blok
  melaporkan `hasLiteralBackslashN: false`, jumlah baris sesuai (3/3/4/1/9), dan
  tidak ada blok yang meluber keluar container-nya.

## Test

- 40 test `db-backup-service.test.js`.
- Suite: **3194 lulus**, 0 regresi baru.

# v0.5.88.15 (2026-10-27)

## Fitur

- **Token download backup berdiri sendiri — satu per mesin mirror.** Sebelumnya
  hanya satu string opaque di dalam settings. Sekarang punya bentuk sendiri
  seperti API key:

  ```
  bk-{machineId16}-{keyId6}-{crc8}
  ```

  - prefix berbeda, jadi token backup tidak pernah tertukar dengan API key
  - machine id terembed, jadi token yang bocor memberi tahu mesinnya
  - crc = HMAC atas machine id + key id, jadi token rusak ditolak **tanpa**
    menyentuh database
  - berlaku hanya untuk satu route (`GET /api/backup/download`). API key
    menjangkau seluruh permukaan LLM — terlalu banyak untuk sebuah mirror

  **Token penuh tidak pernah disimpan.** Yang disimpan hanya key id, machine id,
  dan crc — jadi salinan database (persis yang disalin fitur backup ini) tidak
  ikut membawa akses mirror. Token bisa direkonstruksi dari bagian-bagian itu
  lalu dicocokkan dengan yang presented.

  - `src/shared/utils/backupToken.js` — generate / parse / verify
  - `src/lib/db/repos/backupTokensRepo.js` — list, create, revoke, enable,
    delete, verify, touch (last-used)
  - `src/lib/db/schema.js` — tabel `backupTokens`
  - `src/app/api/backup/tokens` — GET list, POST create, PATCH revoke/re-enable,
    DELETE remove

  Dashboard dapat card **"Periodic Download"**: buat token per mesin, lihat mana
  yang aktif, revoke atau hapus, dan salin perintah curl + cron yang dijalankan
  mirror.

  Card GitHub juga dijelaskan: **git hanya perlu** kalau mirror-nya mau ambil
  dari git remote. Untuk download HTTP cukup curl + entri cron. Kalau tetap mau
  salinan git, ditampilkan setup SSH key (tanpa prompt password di cron).

  Diverifikasi live terhadap dev server yang jalan:

  | | Hasil |
  |---|---|
  | Create | `bk-a32d75a563140403-w6d3ga-bec0dd9c` |
  | Download | HTTP 200, 8.179.712 byte |
  | CRC salah | HTTP 401 "Invalid token" |
  | Bentuk salah | HTTP 401 "Malformed token" |
  | Revoke | HTTP 401 "Token has been revoked" |
  | Re-enable | HTTP 200 |
  | Delete | HTTP 401 "Unknown token" |
  | Dua token | terdaftar terpisah |

## Test

- 39 test di `db-backup-service.test.js` + `db-backup-hydration.test.js`.
- Suite: **3191 lulus**, 0 regresi baru.

# v0.5.88.14 (2026-10-27)

## Perbaikan

- **Panel "Automatic Backup" tidak lagi merusak hydration.** Panel itu
  menaruh `window.location.origin` langsung ke markup. `window.location` kosong
  saat render server, jadi HTML server berisi `/api/backup/download` sementara
  render client pertama berisi `http://localhost:20127/api/backup/download`.
  React melaporkan hydration mismatch dan meregenerasi seluruh tree.

  Sekarang origin disimpan di state yang awalnya kosong — sama dengan render
  server — dan diisi di effect setelah mount, jadi render client pertama sama
  persis dengan HTML server.

  (Variabel `origin` untuk redirect URI OIDC/SAML masih membaca window saat
  render. Itu sudah ada sebelumnya dan tidak disentuh — panel yang berbeda dan
  sudah berperilaku seperti biasa.)

## Test

- 5 test baru `db-backup-hydration.test.js`.
- Suite: **3188 lulus**, 0 regresi baru.

# v0.5.88.13 (2026-10-27)

## Fitur

- **Interval backup sekarang bisa diatur.** Sebelumnya jadwalnya tetap satu
  slot per hari. Sekarang intervalnya jadi pengaturan dalam jam, dipilih dari
  dashboard:

  | Opsi | Setiap |
  |---|---|
  | Every hour | 1 jam |
  | Every 3 hours | 3 jam |
  | Every 6 hours | 6 jam |
  | Every 12 hours | 12 jam |
  | **Every 24 hours (daily)** | 24 jam (default) |
  | Every 48 hours | 48 jam |
  | Every 7 days | 168 jam |

  Scheduler tetap bangun tiap 5 menit lalu mengecek apakah intervalnya sudah
  lewat. `resolveIntervalHours()` membatasi nilainya di 1–168 jam — snapshot
  adalah salinan penuh database, jadi lebih sering dari satu jam hanya menambah
  beban disk dan repo tanpa guna.

- Panel "Automatic Backup" juga menampilkan **perintah persis** untuk mesin
  mirror, jadi URL dan nama header tidak perlu dirangkai manual:

  ```
  curl -H "x-backup-token: <TOKEN>" "<origin>/api/backup/download" \
    -o data.sqlite
  ```

  Diverifikasi live terhadap dev server yang jalan: `intervalHours=6` tersimpan
  dan dikembalikan, `githubToken` tetap tidak ada di response mana pun, dan
  endpoint download tetap melayani file (HTTP 200, 8.179.712 byte).

## Test

- 25 test `db-backup-service.test.js`.
- Suite: **3176 lulus**, 0 regresi baru.

# v0.5.88.12 (2026-10-27)

## Fitur

- **Backup otomatis harian ke repo GitHub private.** VPS menyimpan setiap
  koneksi provider beserta token OAuth-nya. Kalau disk mati atau rilis
  merusak skema, semuanya hilang — token satu-satunya jalan kembali. Salinan
  yang hidup **di luar** box itu jaring pengaman.

  Yang ditambahkan:

  - `src/shared/services/dbBackup.js` — snapshot diambil dengan `VACUUM INTO`
    supaya salinan konsisten **saat server sedang menulis**. Copy file biasa
    dari SQLite yang hidup diam-diam melewatkan semua yang masih ada di
    write-ahead log. `assertRepoIsPrivate()` jadi **gerbang keras**: push
    ditolak kecuali GitHub melaporkan repo itu private — repo publik akan
    menerbitkan setiap token OAuth di box itu. Push memakai remote HTTPS biasa
    dengan token, bentuk yang sama dengan script `vpn-backup` yang sudah jalan
    di VPS ini, jadi tidak perlu tooling tambahan (tidak ada `gh` CLI di server).
  - `POST /api/backup/config` — menyimpan username, token, dan repo GitHub,
    plus membuat **token download terpisah** untuk mesin mirror. Repo
    diverifikasi private **sebelum** konfigurasi diterima. Token GitHub hanya
    bisa ditulis lewat endpoint ini; settings GET menapisnya dan PATCH
    mempertahankan nilai yang tersimpan.
  - `GET /api/backup/download` — menyajikan database ke mesin mirror, dijaga
    token sendiri yang dibandingkan dengan `timingSafeEqual`. Route-nya
    masuk daftar public di guard karena mesin itu memegang token backup, bukan
    session dashboard — tanpa itu request ditolak sebelum route-nya jalan.
  - `POST /api/backup/run` — tombol "Back up now" supaya setup bisa
    diverifikasi tanpa menunggu malam.
  - Profile → "Automatic Backup" — toggle, username, repo, field token, Save,
    Back up now, dan token download yang ditampilkan sekali saat dibuat.

  Diverifikasi live terhadap dev server yang jalan:

  | | Hasil |
  |---|---|
  | Backup | `panrouter-db-2026-10-28.sqlite`, 7.278.592 B, 6,6 detik |
  | GitHub | file ada, ukuran cocok |
  | Download | HTTP 200, 8.179.712 B, `application/vnd.sqlite3` |
  | Restore | `PRAGMA integrity_check = ok`, koneksi terbaca |
  | Auth | tanpa token → 401, token salah → 401, token benar → 200 |
  | Gerbang | repo publik ditolak ("is NOT private — refusing to upload") |

## Test

- 20 test `db-backup-service.test.js`.
- Suite: **3162 lulus**, 0 regresi baru.

# v0.5.88.11 (2026-10-27)

## Perbaikan

- **CodeBuddy: akun yang kena ban tidak lagi menghentikan rotasi.**

  Log sebelumnya:

  ```
  [AUTH] Account 1 BANNED by provider until 2026-11-26T23:42:34.509Z
  [AUTH] Account 2 BANNED by provider until 2026-11-26T23:42:34.711Z
  [AUTH] Account 3 BANNED by provider until 2026-11-26T23:42:38.921Z
  [CHAT] 3 accounts refused by the provider — stopping rotation to protect
         the remaining accounts
  ```

  Ban 30 hari-nya **sudah bekerja**. Yang tidak bekerja adalah berhenti di
  akun ke-3: request gagal padahal masih ada akun sehat lain di pool, dan
  operator harus retry manual.

  Pool itu milik operator — setiap akun yang sehat berhak dicoba. Yang membuat
  burst terlihat seperti otomatisasi adalah **timing**, bukan jumlahnya. Jadi
  rotasi sekarang **menunggu antar akun** alih-alih berhenti.

  - cabang stop-after-N-bans dihapus
  - setiap akun yang kena ban dicatat dan rotasi lanjut
  - jeda rotasi 3 detik (sebelumnya 4) supaya seluruh pool dilewati cepat
    tanpa request ditembakkan beruntun

  Diverifikasi live lewat dev server: `cbai/deepseek-v4.1-flash` HTTP 200 dalam
  4,3 detik dengan akun yang sehat, setelah akun-akun sebelumnya kena ban.

## Test

- 6 test baru `codebuddy-rotation-continues.test.js`.
- `ban-protections.test.js` diperbarui untuk behavior baru.
- Suite: **3154 lulus**, 0 regresi baru.

# v0.5.88.10 (2026-10-27)

## Perbaikan

- **Akun Kiro yang sudah habis kuota bulanan sekarang keluar dari rotasi
  selama SELURUH periode cap.**

  Log sebelumnya:

  ```
  [402]: {"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"}
  [AUTH] Adelia locked modelLock___all for 376727s until 2026-11-01T00:00:00.848Z
  ```

  Kuncinya sudah benar (1 Nov), tapi akunnya tetap dikirimi request.

  Penyebab: `shouldSkipKiroAccount()` keluar lebih awal pada TTL probe 5 menit:

  ```
  if (now - entry.checkedAt > CACHE_TTL_MS) return { skip: false };
  ```

  `checkedAt` adalah waktu 402 itu datang, jadi **lima menit kemudian** entri
  dianggap basi dan akun terlihat sehat lagi — padahal `cappedUntil` masih
  lebih dari empat hari di depan. Router terus memilihnya sampai habis bulan.

  TTL itu ada untuk meng-*expire* probe yang tidak bisa dibaca. Cap dengan
  jendela yang diketahui **bukan basi**: dia otoritatif sampai `cappedUntil`
  lewat.

  Fix: cek jendela cap **lebih dulu**. TTL tetap berlaku untuk entri tanpa
  jendela, jadi reading yang tidak terbaca tidak bisa menonaktifkan akun
  selamanya.

  Ini bug kelas yang sama dengan fix flag Antigravity di v0.5.88.8 (verdict
  persisten yang melewati TTL probe) dan pola yang sudah ditangani MiniMax
  dengan `EXHAUSTED_TTL_MS`.

## Test

- 6 test baru `kiro-cap-ttl.test.js`.
- Test stale-reading di `kiro-cap-cache.test.js` diperbarui: reading basi
  **tanpa** reset di masa depan tetap tidak menahan akun; reading basi
  **dengan** reset di masa depan tetap menahan.
- Suite: **3148 lulus**, 0 regresi baru.

# v0.5.88.9 (2026-10-27)

## Perbaikan

- **CodeBuddy `403 request illegal` sekarang benar-benar ban akun 30 hari.**
  Sebelumnya log menunjukkan:

  ```
  [403]: request illegal
  [AUTH] Account 1 locked modelLock_deepseek-v4.1-flash for 120s [403]
  → 3 akun dikunci sama → "3 accounts refused — stopping rotation"
  ```

  Verdict-nya **benar** (counter ban bercabut naik, jadi `result.banned` = true)
  tapi tidak pernah sampai ke record akun. Penyebabnya:
  `markAccountUnavailable()` tidak punya parameter `banned`, jadi verdict dari
  executor berhenti di `chat.js`. `auth.js` lalu menjalankan rule teks generik
  — dan `errorConfig` sudah tidak punya entri "request illegal" (karena
  `parseError` yang menangani, dan hanya executor yang bisa melihat body
  sebenarnya). Hasilnya: lock generik 120 detik per-model.

  Fix:
  - `chat.js` meneruskan `result.banned` ke `markAccountUnavailable`
  - `markAccountUnavailable` menerima flag `providerBanned`; kalau aktif,
    paksa `banned = true`, `shouldFallback = true`,
    `cooldown = BANNED_ACCOUNT_COOLDOWN_MS` (30 hari)
  - ban sudah menulis `modelLock___all` (per-akun) + `bannedUntil`, jadi akun
    dikeluarkan dari rotasi dan dari "Test connection"

  Hanya executor CodeBuddy yang mengembalikan `banned: true`, jadi flag ini
  praktis khusus CodeBuddy.

  Diverifikasi langsung ke DB (integration test): dengan verdict, record
  dapat `bannedUntil` ~30 hari + `modelLock___all` dan tanpa lock per-model;
  tanpa verdict, error yang sama hanya dapat lock 120 detik per-model.

## Test

- 7 test struktural `codebuddy-ban-verdict-propagation.test.js`.
- 2 test integrasi `codebuddy-ban-live.integration.test.js` (memakai DB
  sungguhan, koneksi scratch selalu dihapus).
- Test lama yang mencari string call-site diperbarui ke format multi-line.
- Suite: **3140 lulus**, 0 regresi baru.

# v0.5.88.8 (2026-10-27)

## Perbaikan

- **Akun Antigravity yang sudah diverifikasi sekarang benar-benar dilepas.**
  Ditemukan saat mengecek akun `ayuantini63` setelah verifikasi browser.

  Gejala: akun sudah eligible lagi (usage API melaporkan `eligible: true`, quota
  row kembali normal), tapi entri KV `antigravity_ineligible` masih
  `flagged: true`. Akun tetap di-skip sampai TTL 15 menit habis.

  Penyebab: `recordAntigravityEligibility()` hanya menghapus entri KV kalau
  cache **di memori** memegang flag tersebut. Setelah restart, map di memori
  kosong sementara entri yang dipersist masih ada — jadi reading yang sehat
  sama sekali tidak menghapus apa pun.

  Fix: entri KV dihapus **tanpa syarat** di cabang sehat. Reading yang sehat
  selalu melepas flag, baik yang ada di memori, yang dipersist, atau keduanya.

  Diverifikasi live di dev server lokal setelah fix:

  | | Nilai |
  |---|---|
  | `ineligible` | `{"eligible": true, ...}` |
  | KV flag | **hilang** |
  | Chat `ag/claude-sonnet-4-6` | **HTTP 200**, "ok", 2,8 detik |

## Test

- Test regresi: menulis flag yang dipersist, mengosongkan cache di memori,
  lalu memastikan reading yang sehat menghapus entri persisten.
- Suite: **3131 lulus**, 0 regresi baru.

# v0.5.88.7 (2026-10-27)

## Fitur

- **Antigravity: akun yang di-flag Google kini di-skip SEBELUM request, dan
  tampil jelas di dashboard.**

  Live MITM capture CLI resmi 1.4.8 (akun `ayuantini63`) membuktikan dua hal:
  gerbangelasnya diumumkan di **dua** tempat, dan CLI resmi **berhenti** di
  situ — `generateAssistantResponse` tidak pernah dikirim:

  | Endpoint | Status | Field |
  |---|---|---|
  | `/v1internal:loadCodeAssist` | 200 | `ineligibleTiers[].reasonCode = "VALIDATION_REQUIRED"` + `validationUrl` + `tierId` |
  | `/v1internal:retrieveUserQuotaSummary` | 403 | `error.details[].reason` + `metadata.validation_url` |

  PanRouter sebelumnya **mengabaikan** `ineligibleTiers` dan hanya regex-scan
  payload untuk kata "verify" — jadi akun yang ter-flag tetap melayani traffic
  dan setiap request jadi sia-sia.

  **Backend:**
  - `google.js` — `parseAntigravityEligibility()` (baca `ineligibleTiers`) dan
    `parseAntigravityQuotaEligibility()` (baca detail 403). Scanner regex
    `logVerificationHint()` yang sudah mati dihapus.
  - `antigravityCapCache.js` (baru) — cache per-koneksi, dipersist ke KV
    supaya flag bertahan setelah restart. Fail-open: probe gagal = "tidak ada
    pendapat", akun tetap dipakai.
  - `usage.js` — mencatat verdict dari reading yang sama dengan tracker.
  - `auth.js` — akun ter-flag di-skip sebelum request keluar (pola
    `kiroCapCache`).
  - `check-release` — branch Antigravity membaca verdict live dan hanya
    melepas flag kalau Google melaporkan akun eligible lagi.
  - `initializeApp.js` — restore flag saat startup.

  **UI (quota tracker):**
  - badge oranye "Needs verification" dengan reason code di tooltip
  - tombol "Copy verify link" (URL-nya panjang dan sekali pakai)
  - link "Verify" yang membuka halaman verifikasi Google

  **UI (halaman providers):** verdict dicerminkan ke `lastError` supaya akun
  ter-flag terlihat di sana juga, dan marker dibersihkan begitu akun eligible
  lagi.

## Test

- 16 test `antigravity-eligibility.test.js` (parser + cache).
- 12 test `antigravity-eligibility-ui.test.js` (badge + wiring).
- Suite: **3131 lulus**, 0 regresi baru.

# v0.5.88.6 (2026-10-27)

## Perbaikan

- **CodeBuddy `[403]: request illegal` tanpa code sekarang men-ban akun 1 bulan.**

  Sebelumnya: backoff 4 detik → retry → rotasi akun → akun lain kena hal sama →
  3 akun refused → stop. Semua akun tetap "available" setelah cooldown.

  Sekarang: akun yang return `request illegal` tanpa code 11128/11140 langsung
  di-ban 30 hari, di-off dari dashboard, dan tidak akan dipilih router lagi
  sampai ban diangkat manual atau 30 hari lewat (siapa tahu pihak CodeBuddy
  sudah cabut ban-nya).

  Bedanya tiga kondisi:

  | Kode | Artinya | Tindakan |
  |---|---|---|
  | 11128 | Request shape salah (per-request) | `requestRejected: true` — akun sehat, jangan kunci |
  | 11140 | Akun di-ban resmi | `banned: true` — ban 30 hari |
  | (tidak ada) | Akun diflag, belum 11140 | **Sekarang: `banned: true` — ban 30 hari** |

## Test

- Test baru `codebuddy-request-illegal-ban.test.js` (4 test).
- Test lama `codebuddy-block-backoff.test.js` diupdate: 11128 = parseError
  (bukan errorConfig), plain `request illegal` = banned (bukan backoff).
- Suite: **3101 lulus**, 0 regresi baru.

# v0.5.88.5 (2026-10-27)

## Perbaikan

- **CodeBuddy: header disamakan persis dengan CLI 2.170.0 (MITM live capture).**
  Sebelumnya PanRouter mengirim header yang terlihat seperti client IDE pihak
  ketiga. Koreksi berdasarkan capture live:

  | Header | Sebelum | Sesudah |
  |---|---|---|
  | `User-Agent` / `X-IDE-Type` / `X-IDE-Name` | `IDE/2.170.0` / `IDE` | `CLI/2.170.0` / `CLI` |
  | `X-Agent-Type` | `ide` | `main` |
  | `X-Agent-Runtime` | `ide` | `other` |
  | `x-stainless-arch` | `amd64` | `x64` |
  | `X-Root-Request-ID` | tidak ada | ada |
  | `traceparent` / `b3` / `X-B3-*` / `X-Trace-ID` | tidak ada | ada (OTel/Zipkin) |
  | `baggage` | tidak ada | ada |

- **Quota habis → kunci per-akun, bukan per-model.** Codex 429, Cline daily,
  TokenHarbor weekly, dll. sekarang tulis `modelLock___all` — router tidak lagi
  buang N request ke model lain di akun yang kosong semua.

- **Hitung mundur cooldown (⏱) sekarang tampil untuk Kiro dan semua akun
  quota-parked.** Fix bug `sort()[0]` yang memilih lock expired + tidak membaca
  `quotaExhaustedUntil`. Helper bersama `src/shared/utils/cooldown.js`.

## Test

- 36 lulus di `codebuddy-intl-cli-identity.test.js` (header CLI).
- 4 baru di `quota-exhausted-account-lock.test.js`.
- 19 baru di `cooldown-countdown.test.js` + `cooldown-countdown-live-lock.test.js`.
- Suite: **3097 lulus**, 0 regresi baru.

# v0.5.88.4 (2026-10-27)

## Perbaikan

- **Hitung mundur (⏱) untuk Kiro dan semua akun quota-parked sekarang
  tampil** seperti Codex. Ada dua bug yang menyebabkan timer tidak muncul:
  (1) `sort()[0]` memilih lock paling awal termasuk yang expired — kalau ada
  expired + live, yang expired menang, diff negatif, timer blank;
  (2) `quotaExhaustedUntil` tidak pernah dibaca dashboard.
  Fix: shared helper `src/shared/utils/cooldown.js` dengan `getCooldownUntil`
  (lock terlama yang live + fallback `quotaExhaustedUntil`) dan
  `formatCooldownRemaining`. Semua timer di providers dashboard kini konsisten.

## Test

- 19 test baru: unit helper + cek struktural komponen dashboard.
- Suite: 3069 lulus, 0 regresi.

# v0.5.88.3 (2026-10-27)

## Fitur

- **Kiro menampilkan kapan kuota bulanannya reset — seperti Codex.** Log
  sebelumnya:

  ```
  [14:01:25] ⚠️ [AUTH] Adelia locked modelLock___all for 406715s [402]
  ❌ kiro [402]: {"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"}
  ```

  Kuncinya sudah benar (406715 detik persis tanggal 1 bulan depan), tapi tidak
  ada yang menyebut **kapan**. "locked for 406715s" bikin orang menebak 30
  menit atau sebulan. Codex sudah menampilkan
  "Quota exhausted — resets 2026-11-17T02:43:32.000Z" + hitung mundur
  "⏱ 500h 32m". Sekarang Kiro sama:

  - baris log AUTH membawa tanggal reset dalam format ISO, bukan cuma durasi
  - record koneksi memakai **satu** timestamp reset yang sama untuk kunci,
    teks error, dan `quotaExhaustedUntil` — jadi dashboard dan router tidak
    mungkin berbeda pendapat soal kapan akun aktif lagi
  - quota tracker mendapat baris "monthly" yang **selalu ada**, bahkan kalau
    upstream mengembalikan breakdown kosong untuk akun yang sudah habis
    (sebelumnya kartunya kosong, tidak menampilkan reset sama sekali)
  - nilai remaining di baris tracker dihitung dari used/total. Baris usage Kiro
    adalah jumlah request absolut, jadi meneruskan `remaining` mentah akan
    menampilkan "40%" untuk baris yang terpakai 60%

  Jendela bulanan Kiro reset tanggal 1; tanggal reset diambil dari
  `nextDateReset` di usage API, dengan fallback kalender 1 pukul 00:00 UTC.

## Test

- Test baru `kiro-reset-visibility.test.js` (13 test): log memuat tanggal
  reset, record memakai satu timestamp konsisten, baris tracker selalu ada,
  dan remaining dihitung sebagai persentase.
- Suite: **3069 lulus**, 0 regresi baru.

# v0.5.88.2 (2026-10-27)

## Fitur

- **Antrean Qoder: tunggu, lalu ulangi di akun yang sama.** Antrean Qoder
  (`code 10605`, `isQueued:true`, `queueCount:0`, `serviceAvailable:false`)
  berarti modelnya **gratis tapi sedang sibuk** untuk semua key — itu antrean,
  bukan error. CLI resmi menampilkan hal yang sama ("Model request queued (34s)",
  "estimated wait less than 1min") dan berhasil begitu antrean surut.

  Rotasi akun tidak akan membantu: setiap akunmeet antrean yang sama, dan
  tiap percobaan memakai kuota akun itu. Jadi request sekarang **menunggu
  `retryAfterSeconds` dari provider (30 detik) lalu mengulangi di akun yang
  sama**, paling banyak dua kali. Kalau masih antre, request dilaporkan sebagai
  terantre dan akun **tidak disentuh** — tanpa kunci, tanpa rotasi — supaya
  tetap tersedia.

  Diukur lewat dev server yang sedang jalan:

  | | Nilai |
  |---|---|
  | Durasi | HTTP 429 setelah **62,4 detik** (2 × 30 detik) |
  | Akun | **sama** sepanjang (`consecutiveUseCount` tetap 1) |
  | Kunci model baru | **tidak ada** |

## Test

- Test `qoder-queue-retry.test.js`: antrean di-retry di akun yang sama, jeda
  mengikuti `retryAfterSeconds`, tidak ada rotasi selama antre, tidak ada kunci
  akun, dan jendela antrean dilaporkan ke klien.
- Suite: **3063 lulus**, 0 regresi baru.

# v0.5.88.1 (2026-10-27)

## Perbaikan

- **Request Qoder yang masuk antrean sekarang di-skip, bukan di-retry dan bukan
  dirotasi.** Antrean itu bersifat global: Qoder melaporkan `code 10605` dengan
  `isQueued: true`, `queueCount: 0` dan `serviceAvailable: false` — tidak ada
  siapa pun di depan kita, kapasitas bersama model itu memang sedang penuh. CLI
  resmi menampilkan antrean yang sama ("Model request queued (34s)", "estimated
  wait less than 1min") dan berhasil begitu antrean surut.

  Retry maupun rotasi hanya membuang-buang request untuk jawaban yang sama.
  Sekarang request dilaporkan sebagai terantre dan akun **tidak disentuh**:

  - tidak ada retry (antrean urusan provider)
  - tidak ada rotasi akun (semua akun dapat antrean yang sama)
  - tidak ada kunci model (akunnya sehat)

  Diukur langsung ke endpoint lewat dev server yang sedang jalan:

  | | Sebelum | Sesudah |
  |---|---|---|
  | Durasi | HTTP 429 setelah **62,7 detik** | HTTP 429 setelah **1,3 detik** |
  | Kunci akun | ditulis | **tidak** |

- **403 yang bukan error auth tidak lagi memicu refresh token.** Aturan umum
  "401 atau 403 → refresh dan coba lagi" tidak berlaku untuk 403 dari antrean
  Qoder (`10605`) maupun dari CodeBuddy (`11128`/`11140`). Refresh tidak akan
  memperbaikinya, dan jalur refresh memakan tiga percobaan (6 detik backoff) plus
  satu request sia-sia sebelum error sebenarnya dilaporkan.

- `HTTP_STATUS.TOO_MANY_REQUESTS` yang **tidak pernah ada** di `runtimeConfig`
  (konstantanya `RATE_LIMITED`) — cabang antrean akan melempar error.

## Test

- Test `qoder-queue-retry.test.js` ditulis ulang: antrean di-skip, tidak ada
  retry, tidak ada kunci akun, dan jendela antrean dilaporkan ke klien.
- Test `error-rules-daily-quota.test.js` dibuat tahan waktu (sebelumnya gagal
  kalau suite berjalan di menit terakhir sebelum tengah malam UTC).
- Suite: **3062 lulus**, 0 regresi baru.

# v0.5.88.0 (2026-10-27)

## Perbaikan

- **Identitas request Qoder sekarang sama persis dengan CLI resmi 1.1.78.**
  Request asli dari `qodercli` ditangkap lewat MITM proxy
  (`scripts/qoder-mitm-addon.py`) lalu dibandingkan header demi header.

  | Field | Sebelum | Sesudah (tangkapan CLI) |
  |---|---|---|
  | `Cosy-Version` | `1.0.0` | `1.1.78` |
  | `Cosy-MachineOS` | `x86_64_windows` | `x86_64_win32` |
  | `Cosy-MachineType` | `5` | UMID 16-byte hex, stabil per mesin |
  | `Cosy-MachineToken` | = machine-id | token 64 char base64url |
  | `Cosy-MachineHostname` | — | hostname asli |
  | `Cosy-Data-Policy` | `disagree` | `agree` |
  | `Cosy-Scene` | — | `assistant` |
  | `Cosy-Business-Product` | — | `cli` |
  | `Cosy-Business-Type` | — | `agent` |
  | `User-Agent` | — | `Bun/1.4.2` |
  | `traceparent` | — | W3C trace context |

  **Nama header dicocokkan case-sensitively** dan huruf besarnya milik CLI
  (`Cosy-MachineId`, bukan `Cosy-Machineid`) — ini berlaku untuk enam header
  `Cosy-Machine*`/`Cosy-ClientType`.

  Header yang **tidak pernah** dikirim CLI juga dihapus: `Cosy-Bodyhash`,
  `Cosy-Bodylength`, `Cosy-Sigpath`, `Cosy-Clientip`, `Cosy-Organization-Id`,
  `Cosy-Organization-Tags`.

  `business.version` di payload tidak lagi bertentangan dengan header
  `Cosy-Version` (keduanya `1.1.78`).

- **Host inferensi memakai `api2.qoder.sh` untuk semua request**, sama seperti
  CLI. Sebelumnya device token diarahkan ke `api3.qoder.sh`; hasil A/B: kedua
  host menjawab identik, jadi ini soal mencocokkan CLI, bukan memperbaiki
  kesalahan.

- **UMID lokal yang stabil per mesin.** Server headless tidak punya layanan
  UMID Qoder, jadi nilainya diturunkan sendiri dengan bentuk yang sama
  (16 byte hex, 64 char base64url, UUID v4) dan disimpan di
  `~/.9router/qoder/fingerprint.json` supaya restart tidak terlihat seperti
  mesin baru.

## Catatan

- Pengujian langsung: `refresh_device_token` untuk akun tersebut **berhasil**
  (HTTP 200, token baru sampai 2026-11-26) — akunnya sehat. CLI dan PanRouter
  memakai **akun berbeda**, jadi "CLI jalan, kita gagal" bukan perbandingan
  yang sebanding.
- Body CLI terenkripsi (AES) dan dikirim `Content-Encoding: zstd`, sedangkan
  PanRouter mengirim JSON plaintext. Signature COSY dihitung dari body, jadi
  ini masih menjadi candidat penyebab `10605` — perlu reverse engineering
  layer enkripsi CLI (Tahap 2).

## Test

- Test `qoder.test.js` diperbarui ke tangkapan CLI: casing header, header
  khusus CLI yang wajib ada, header yang tidak boleh ada, bentuk UMID/token, dan
  host api2.
- Suite: **3052 lulus**, 0 regresi baru.

# v0.5.87.0 (2026-10-27)

## Fitur

- **Blok 24 jam MiniMax bertahan setelah restart.**<Block MiniMax sebelumnya hanya
  ada di memori, jadi server restart "lupa" bahwa akun sudah habis dan langsung
  mengprobe lagi. Sekarang blok ditulis ke KV store (`scope: minimax_cap`) dan
  dipulihkan saat startup — sama seperti `CACHE_BLOCK` Antigravity. Entri yang
  sudah lewat 24 jam dibuang saat load.

- **Tombol "Cek & Lepas"** (`lock_open`) di dashboard Usage, di sebelah tombol
  refresh kuota. Endpoint barunya: `POST /api/usage/[connectionId]/check-release`.

  Tombol ini **bukan** "buka regardless": ia membaca kuota langsung dari
  provider dulu, dan hanya melepas blok kalau provider memang sudah melayani
  akun itu lagi. Kalau tracker tidak bisa dibaca, blok **tetap dibiarkan** —
  melepas akun yang habis hanya menghasilkan 429 lagi.

## Perilaku setelah perubahan

| Kejadian | Hasil |
|---|---|
| Limit kena 23:50 | blok 24 jam, akun di-skip tanpa request |
| Top-up 23:52 | tracker dibaca → blok lepas → akun aktif lagi |
| Top-up besok + tracker dibaca | blok lepas otomatis, tidak perlu klik |
| Restart server | blok tetap ada (dari DB) |
| Tracker masih bilang habis | blok tetap, pesan jelas ditampilkan |

## Test

- 15 test baru: tulis/baca KV, pemulihan saat startup, pembersihan blok basi,
  fail-open, jendela 24 jam, pelepasan oleh bacaan terbaru, perilaku endpoint,
  dan tombol dashboard.
- Suite: **3052 lulus**, 0 regresi baru.

# v0.5.86.0 (2026-10-27)

## Perbaikan penting

- **MiniMax Code: akun yang plan-nya habis diparkir 24 jam, dan di-skip
  sebelum request dikirim.**

  ```
  [AUTH] Account 1 locked modelLock_MiniMax-M3.1-Flash for 300s [429]
  minimax-code-global [429]: {"type":"error","error":{"type":"rate_limit_error",
    "message":"usage limit reached: insufficient balance (1008)"}}
  ```

  Dua bug:

  1. **"insufficient balance" tidak dikenali sebagai penolakan kuota**, sehingga
     jatuh ke backoff 429 generik — **300 detik flat**. Padahal plan window-nya
     **punya reset time** (tracker melaporkan persentase sisa dan `end_time`),
     tapi PanRouter baru tahu dari 429, jadi akun di-probe ulang tiap 5 menit dan
     tiap probe memakai request sungguhan.

  2. **Guard frequency-limit jalan lebih dulu** dan mencocokkan "usage limit
     reached" sebagai burst throttle, jadi penolakan plan tidak pernah sampai ke
     jalur kuota.

  Perubahan:

  - `"insufficient balance"` adalah penolakan kuota; `"usage limit reached"`
    polos tetap di jalur burst (bisa jadi throttle biasa)
  - Aturan baru khusus `minimax-code` / `minimax-code-global`: **blok 24 jam
    flat**. Plan yang habis di tengah percakapan 470 ribu token tidak layak
    dicoba lagi dalam beberapa jam
  - `auth.js` tidak lagi membiarkan resolver kuota menimpa blok 24 jam dengan
    reset time dari tracker (plan window bisa melaporkan reset hanya dua jam
    lagi)
  - `open-sse/services/minimaxCapCache.js` mengingat bacaan tracker per
    koneksi, jadi akun habis **dilewati sebelum request dikirim**. Bacaan
    terbaru melepaskannya begitu plan terisi ulang, tanpa menunggu blok habis

## Catatan

- `unit/error-rules-daily-quota.test.js` sensitif waktu — test itu mengasumsikan cooldown
  harian mendarat di 00:00 UTC dan gagal kalau suite dijalankan beberapa menit
  terakhir sebelum tengah malam UTC. Sudah diverifikasi pre-existing (gagal
  sama dengan perubahan ini di-stash).

## Test

- 20 test baru: klasifikasi, blok 24 jam, kedua provider, provider lain tidak
  terpengaruh, cache skip, TTL, dan pelepasan oleh bacaan terbaru.
- Suite: **3034 lulus**, 0 regresi baru.

# v0.5.85.0 (2026-10-22)

## Fitur

Enam perlindungan terhadap ban provider (`11140`). Ban bersifat **menular lewat
pola request**, bukan lewat akun: rotasi 20 akun dalam 13 detik dengan satu
conversation id adalah bentuk yang memicu ban, dan semua akun di pool ikut
ditandai. Tidak ada satu pun dari perubahan ini yang mengubah request yang
berhasil.

### 1. Akun banned ditandai dan tidak pernah dipilih lagi

`open-sse/services/bannedAccounts.js` mencatat `bannedUntil` + `banReason` di
koneksi. `auth.js` melewati akun itu di dalam filter kandidat, dan "Test
connection" **melaporkan ban-nya** alih-alih mengirim request lagi ke akun yang
tadi ditolak provider. Tanda kedaluwarsa sendiri (30 hari), dan
`PUT /api/providers/[id]` dengan `{ unban: true }` membersihkannya beserta kunci
rotasi.

### 2. Akun yang sama dicoba sekali lagi sebelum pindah

Penolakan `11128` (channel verification) sering bersifat transient, dan tetap di
satu akun menjaga prompt cache dan conversation id tetap konsisten. Retry
terjadi **sebelum** akun dikunci — kalau setelahnya, kunci tersebut justru
mendorong retry ke akun lain, yaitu rotasi yang justru ingin dihindari.

### 3. Rotasi menunggu (4 detik)

Lima akun dalam 13 detik terlihat seperti otomatisasi; lima akun dalam 20 detik
tidak.

### 4. Setelah 3 ban berturut-turut, rotasi dihentikan

Error dikembalikan ke klien dan akun sisanya **tidak pernah disentuh**.

### 5. CAVEMAN dan PONYTAIL bisa dimatikan per provider

CLI resmi CodeBuddy tidak pernah menyuntik system prompt tambahan, jadi injeksi
itu bagian dari yang membuat request terlihat buatan. Setting baru: **CodeBuddy
safe mode** di dashboard Token Saver, mematikan `cavemanDisabledProviders` /
`ponytailDisabledProviders` untuk `codebuddy-intl` saja.

### 6. Request ke akun **cold** dipotong sebelum dikirim

Prompt cache CodeBuddy terikat akun, jadi request yang diputar ke akun lain
mengunggah seluruh riwayat — **412 ribu token**. `open-sse/services/messageTrimmer.js`
membuang giliran tertua (system prompt dan giliran terbaru selalu disimpan)
sekali per percakapan, sehingga unggahan cold tidak lagi berbentuk yang paling
berisiko di-flag.

## Test

- 28 test baru: penandaan ban, skip, unban, retry akun sama, jeda, batas ban,
  opt-out per provider, dan trimming.
- Suite: **3011 lulus**, 0 regresi baru.

# v0.5.84.1 (2026-10-22)

## Perbaikan

- **ID percakapan CodeBuddy sekarang UUID v1 (time-based), sama seperti CLI
  resmi.** CLI membuat id percakapan sebagai UUID v1: id itu meng-*encode*
  timestamp pembuatan dan node id, sehingga pembaca bisa tahu **kapan**
  percakapan dibuka dan **mesin mana** yang membukanya. UUID v5/v7 (content hash)
  tidak membawa informasi itu.

  Contoh yang gegeben operator persis format itu:

  ```
  6ba7b810-9dad-11d3-a456-426614174000
  version 1 · timestamp 1999-11-18 · node 42:66:14:17:40:00
  ```

  Perubahan:

  - `uuidV1()` membangun UUID versi 1 yang benar: `ticks = unixMs * 10000 +
    0x01b21dd213814000`, nibble versi `1`, bit varian RFC-4122, node id konstan
  - `X-Conversation-ID` **dipin** ke saat percakapan pertama terlihat (di-cache
    per seed). Tanpa pin, timestamp v1 berubah tiap giliran — jadi id itu
    bukan lagi id percakapan
  - `X-Conversation-Message-ID` / `-Request-ID` / `X-Request-ID` adalah id v1
    baru tiap giliran, dengan `request-id == message-id` seperti CLI

  Pola CLI terverifikasi dari bundle yang terpasang:

  ```js
  CONVERSATION_ID         = el.id               // stabil per percakapan
  CONVERSATION_MESSAGE_ID = randomUUID()        // baru tiap giliran
  CONVERSATION_REQUEST_ID = CONVERSATION_MESSAGE_ID
  ```

## Test

- 5 test baru: versi UUID 1 untuk conversation-id dan per-turn id, bit varian
  RFC-4122, node id tetap, dan stabilitas conversation-id vs rotasi per-turn id.
- Suite: **2987 lulus**, 0 regresi baru.

# v0.5.84.0 (2026-10-22)

## Perbaikan penting

- **CodeBuddy `11140` sekarang diperlakukan sebagai BAN, bukan cooldown.**
  Pengujian langsung ke endpoint dengan token akun sendiri menunjukkan dua gerbang
  berbeda yang tersembunyi di balik `msg` generik yang sama:

  | Kode | Pesan sebenarnya | Arti |
  |---|---|---|
  | `11128` | first message is not system prompt | bentuk request salah |
  | `11140` | Your account has been restricted due to unusual activity | **akun di-ban** |

  Body `11140` juga membawa `msg: "request illegal"`, sehingga aturan generik
  menelannya dan akun hanya dikunci 30 menit — bukan diparkir. Ban yang dicoba
  ulang tiap 12–30 menit justru adalah pola retry yang memicu ban itu.

  Perubahan:

  - Aturan baru `banned` + `BANNED_ACCOUNT_COOLDOWN_MS` (30 hari)
  - Executor mengembalikan `{ banned: true }` **tanpa** `resetsAtMs`
  - `auth.js` mengunci **seluruh akun** (`modelLock___all`), bukan satu model
  - Pencocokan berdasarkan **kode error provider**, sehingga alias `cbai` juga
    tertangani (aturan upstream yang berbasis nama provider melewatkan alias)

- **Port upstream 9router PR #5024** (`codebuddy-block-backoff`):

  ```js
  { provider: "codebuddy-intl", text: "request illegal",          backoff: true },
  { provider: "codebuddy-intl", text: "conversation id missing", backoff: true },
  ```

  Backoff eksponensial 2s → 4s → 8s, bukan cooldown 403 yang tetap. Ditambah
  guard **request-scoped**: error `400` yang disebabkan request itu sendiri
  (context overflow, body malformed) tidak lagi mendinginkan akun — dengan satu
  koneksi saja, itu membuat setiap request berikutnya gagal dengan
  "all 1 accounts locked" dan menyembunyikan penyebab sebenarnya.

- **`open-sse/config/providerAlias.js`** memetakan alias → id dari registry,
  sehingga aturan berbasis provider bekerja tanpa menambah coupling
  `open-sse` → `src`.

## Test

- 14 test baru untuk port upstream + ban 11140 (klasifikasi, durasi,alias,
  `displayMsg`, dan wiring `banned`).
- 4 test lama diperbarui karena behavior yang berubah sengaja
  (`11140` bukan lagi cooldown 12 jam; string plumbing berubah).
- Suite: **2982 lulus**, 0 regresi baru.

# v0.5.83.4 (2026-10-22)

## Perbaikan penting

- **Cache blok Kiro bertahan setelah restart dan update.** Di v0.5.83.3 cache-nya
  hanya di memori, jadi setiap restart atau pembaruan PanRouter **lupa** bahwa
  akun sedang limit bulanan — dan mulai mengirim request lagi ke akun itu.

  Sekarang mengikuti pola `CACHE_BLOCK` Antigravity: entri yang habis ditulis ke
  KV store (`scope: kiro_cap`) dan dipulihkan saat startup dari
  `initializeApp.js`.

  | Kondisi saat load | Tindakan |
  |---|---|
  | Reset masih di depan | dipulihkan, akun tetap dilewati |
  | Reset sudah lewat | dibuang + dihapus dari store |
  | Bacaan sehat | entri dihapus |
  | Error KV | diabaikan (fail-open) |

  Jadi akun yang limit tanggal 1 tidak akan dicoba lagi hanya karena PanRouter
  di-restart atau di-update di tengah bulan.

## Test

- 5 test baru: penulisan ke KV, pembersihan saat sehat, pemulihan saat startup,
  pembuangan entri kadaluarsa, dan sifat fail-open.
- Suite: **2966 lulus**, 0 regresi baru.

# v0.5.83.3 (2026-10-22)

## Perbaikan penting

- **Kiro: akun yang limit bulanan di-skip SEBELUM request dikirim.** Sebelumnya
  PanRouter baru tahu setelah mendapat `402`:

  ```
  [AUTH] Adelia locked modelLock_claude-sonnet-4.5-thinking-agentic for 120s [402]
  ❌ kiro [402]: {"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"}
  ```

  Dua bug sekaligus:

  1. **Sinyalnya tidak dikenali.** Body-nya tidak memuat kata "quota", jadi
     `isQuotaExhaustedError` mengembalikan `false` dan error jatuh ke cooldown
     generik **120 detik**. Router mencoba lagi akun yang sudah habis sebulan
     setiap dua menit.

  2. **Kuncinya per model, padahal limitnya seluruh akun.**
     `MONTHLY_REQUEST_COUNT` menolak **semua** model di akun itu, tapi yang
     dikunci hanya `modelLock_<model>`. Akibatnya akun yang sama dicoba lagi
     untuk model berikutnya, satu per satu.

  Perbaikan:

  - `MONTHLY_REQUEST_COUNT` dan "You have reached the limit." sekarang masuk
    kelas kuota, sehingga `auth.js` membaca reset asli dari usage API Kiro
    (`nextDateReset`); cadangan kalender adalah tanggal 1 bulan berikutnya
    dengan batas 40 hari.
  - Kunci menjadi **tingkat akun** (`modelLock___all`), sama seperti limit
    bulanan GitHub.
  - `open-sse/services/kiroCapCache.js` menyimpan bacaan quota tracker
    (`used`/`total`/`resetAt`) per koneksi, dan `auth.js` melewati akun itu
    **di dalam filter akun tersedia** — jadi akun yang limit tidak pernah
    mencapai upstream sama sekali. Bersifat advisory dengan TTL 5 menit: tanpa
    bacaan, akun tetap dianggap layak.

## Test

- 21 test baru: klasifikasi `MONTHLY_REQUEST_COUNT`, kunci tingkat akun, skip
  sebelum request, TTL kadaluarsa, reset yang sudah lewat, dan akun tanpa
  bacaan tetap dipakai.
- Suite: **2963 lulus**, 0 regresi baru.

# v0.5.83.2 (2026-10-22)

## Perbaikan penting

- **Koneksi klien yang terputus tidak lagi mematikan server.** Log crash:

  ```
  Error: aborted
      at abortIncoming (node:_http_server:796:17)
      at socketOnClose (node:_http_server:790:3)
  ```

  `abortIncoming` adalah jalur internal Node untuk *"klien menutup socket saat
  request masih berjalan"*. Browser melakukan ini terus-menerus: pindah
  halaman, tutup tab, `fetch` dibatalkan, stream SSE dihentikan. Itu lalu lintas
  normal, bukan kerusakan router.

  Server **tidak punya handler tingkat proses sama sekali**, sehingga satu
  koneksi terputus menjadi *unhandled rejection*, mematikan proses, lalu CLI
  me-restart dan mencetak seluruh stderr sebagai "crash log".

  `src/lib/processGuards.js` memasang penjaga `uncaughtException` dan
  `unhandledRejection` dari `instrumentation.js` (hanya runtime `nodejs`):

  - error socket/abort yang wajar dicatat **sekali** (dedupe 60 detik) lalu
    diabaikan
  - error lain tetap dicatat beserta stack-nya, dan proses **tetap hidup**

  Sengaja fail-open: mematikan semua request yang sedang berjalan karena satu
  kegagalan jauh lebih buruk daripada mencatatnya.

## Verifikasi

`scripts/verify-process-guards.mjs` menguji end-to-end dengan stack asli dari log:

| Pemeriksaan | Hasil |
|---|---|
| Stack `abortIncoming` dikenali sebagai disconnect | ✅ |
| Peringatan dicatat tepat sekali | ✅ |
| Bug asli tetap dilaporkan | ✅ |
| Proses bertahan | ✅ PASS |

## Test

- 7 test baru: handler terpasang, hanya di runtime `nodejs`, tidak pernah
  `throw`, dan pengenalan `abortIncoming`/`ECONNRESET`/`EPIPE`/
  `ERR_STREAM_PREMATURE_CLOSE`.
- Suite: **2935 lulus**, 0 regresi baru.

# v0.5.83.1 (2026-10-22)

## Perbaikan

- **Antrean yang menetap tidak lagi mengunci akun.** Setelah percobaan ulang
  habis, `chat.js` mengembalikan `429` **tanpa** memanggil
  `markAccountUnavailable`. Alasannya: kapasitas Qoder dibagi ke semua key, jadi
  memutar akun akan mendapat jawaban yang sama — mengunci akun hanya
  menyembunyikan akun sehat.

## Kenapa ini antrean global, bukan antrean biasa

Payload `10605` dari Qoder selalu sama:

| Field | Nilai | Arti |
|---|---|---|
| `queueCount` | **0** | tidak ada siapa pun di depan kita |
| `queueType` | `p3` | kelas prioritas sama untuk semua |
| `retryAfterSeconds` | `30` | angka tetap, bukan estimasi dinamis |
| `serviceAvailable` | **false** | layanan model sedang tidak tersedia |
| `subCode` | `RESOURCE_LIMIT` | kapasitas sumber daya habis |

`queueCount: 0` adalah buktinya: antrean sungguhan akan menunjukkan berapa
permintaan di depan kita. Angka nol berarti **tidak ada antrean** — kapasitas
model bersama sedang penuh.

## Pengukuran

Dengan satu akun (`probe-qoder-queue-scope.mjs`):

| Skenario | Hasil |
|---|---|
| Enam model berbeda, bersamaan | **semua OK** (534–775 ms) |
| Empat request model sama, bersamaan | **semua OK** (5,6–5,9 s) |

Jadi akun tidak diserialkan dan batasnya bukan per akun.

## Test

- 1 test baru: `429` dikembalikan tanpa mengunci akun saat antrean menetap.
- Suite: **2938 lulus**, 0 regresi baru.

# v0.5.83.0 (2026-10-22)

## Fitur

- **Antrean Qoder ditunggu, bukan mengunci akun.** `10605 isQueued` berarti
  **model** sedang sibuk, bukan akun bermasalah. PanRouter sekarang menunggu
  `retryAfterSeconds` dari Qoder (maksimum 45 detik) lalu mencoba **akun yang
  sama** lagi, paling banyak dua kali. Kalau model masih penuh, `429` tetap
  muncul seperti sebelumnya agar model yang benar-benar penuh tidak dicoba
  selamanya.

  Sebelumnya akun sehat dikunci 30 detik dan klien harus mengulang dari awal.

## Bukti pengukuran

Diuji langsung ke API Qoder dengan **satu akun**:

| Skenario | Hasil |
|---|---|
| Berurutan | `dfmodel` 2712 ms ok · `qfmodel` 1124 ms ok |
| Paralel, dua model berbeda | `dfmodel` 906 ms ok ∥ `qfmodel` 1733 ms ok |
| Paralel, model sama dua kali | `dfmodel` #1 1295 ms ok ∥ #2 1355 ms ok |
| `qfmodel` enam kali | **6/6 ok** |

Kesimpulan: **satu akun bisa menjalankan beberapa model sekaligus**, dan antrean
hilang sendiri dalam hitungan detik. Probe disertakan di repo
(`scripts/probe-qoder-concurrency.mjs`, `scripts/probe-qoder-repeat.mjs`).

## Perbaikan

- **Flag `queueThrottle` sebelumnya hilang di tengah jalan.**
  `parseUpstreamError` dan `createErrorResult` hanya meneruskan field yang
  dikenal, sehingga `chat.js` tidak pernah tahu ini antrean dan tetap mengunci
  akun. Keduanya sekarang meneruskan flag tersebut.

## Test

- 11 test baru: flag antrean, bukan pembatasan akun, bukan `fatal`, nama model
  dari konteks, urutan retry sebelum `markAccountUnavailable`, batas jumlah
  percobaan, dan batas waktu tunggu.
- Suite: **2934 lulus**, 0 regresi baru.

# v0.5.82.7 (2026-10-22)

## Perbaikan

- **Pesan antrean Qoder tidak lagi menampilkan `model "?"`.** Payload `10605`
  biasanya tidak memuat `modelKey`, sehingga log berbunyi:

  > Qoder: model "?" is queued (admission queue) — retry in 30s

  `parseError` sekarang menerima konteks `{ model, provider }` yang diteruskan
  `chatCore` lewat `parseUpstreamError`, dan memakai nama model dari request
  sebagai cadangan. Tanpa konteks sama sekali ditulis "this model", bukan tanda
  tanya kosong.

## Catatan

- `qfmodel` kena antrean upstream (`10605`) adalah **perilaku normal**, bukan bug:
  Qoder membatasi berapa permintaan yang boleh berjalan bersamaan per model.
  PanRouter sekarang menunggu **30 detik** sesuai `retryAfterSeconds` yang
  dikirim Qoder, bukan 120 detik seperti sebelumnya.
- `dfmodel` pada request yang sama berjalan normal (DONE 5736 ms, IN 68 /
  OUT 328) — jadi antrean itu per model, bukan per akun.

## Test

- 2 test baru: pemakaian nama model dari konteks request, dan jaminan tidak ada
  tanda tanya kosong di pesan.
- Suite: **2923 lulus**, 0 regresi baru.

# v0.5.82.6 (2026-10-22)

## Perbaikan penting

- **`dfmodel` adalah DeepSeek gratis di Qoder, bukan `dfmodel_v41`.** Diuji
  langsung ke API OAuth dengan akun gratis:

  | Model | Hasil |
  |---|---|
  | `dfmodel` | **200 OK** — DONE 1931 ms, IN 31 / OUT 91 |
  | `dfmodel_v41` | **403** `code 112` + `pricingUrl` |

  Spesifikasi DeepSeek-V4.1-Flash-1017 yang menjadi dasar `dfmodel_v41`
  menggambarkan tier **IDE**, bukan tier API. Registry menampilkan
  `dfmodel_v41` sebagai "DeepSeek-Flash (Free)" sementara model yang benar-benar
  menjawab gratis (`dfmodel`) diberi label "DeepSeek-V4-Flash" — UI menjanjikan
  model gratis yang ternyata meminta pembayaran.

  Label ditukar di kedua region. `dfmodel_v41` tetap terdaftar untuk akun
  berbayar dan mempertahankan jendela 200K.

## Catatan

- Model gratis lewat API OAuth: **`qd/dfmodel`** (intl) dan **`qdcn/dfmodel`**
  (CN). Gunakan itu untuk DeepSeek tanpa biaya.
- `dfmodel_v41` membutuhkan kredit; error `112` sekarang diparkir sesuai batas
  kuota provider, bukan 120 detik.

## Test

- 9 test baru mengunci label gratis/berbayar kedua model di dua region,
  jendela konteks, dan entri peta model.
- Suite: **2920 lulus**, 0 regresi baru.

# v0.5.82.5 (2026-10-22)

## Perbaikan penting

- **Qoder `112` diklasifikasikan sebagai penolakan billing.** Qoder membalas
  `112` dibungkus tiga tingkat JSON dengan `pricingUrl` — akun harus membeli
  kredit. Body-nya tidak memuat kata "quota", sehingga
  `isQuotaExhaustedError` mengembalikan `false` dan error jatuh ke backoff
  generik: model dikunci **120 detik** dan router mencoba lagi akun yang butuh
  pembayaran setiap dua menit.

  `112` (dan `110` untuk hitungan harian) sekarang masuk kelas kuota, sehingga
  durasi kunci memakai batas kuota provider, bukan batas burst 30 menit.

  `10605` (antrean admission), frequency limit, dan limit kapasitas site-wide
  tetap **bukan** kuota.

## Catatan

- **Header Qoder sudah benar.** `qfmodel` berhasil (2183 ms, IN 62 / OUT 30) pada
  request yang sama dengan header identik, jadi `112` bukan masalah UA/header
  melainkan billing per model.
- `dfmodel_v41` sekarang terkirim berkat fallback peta statis, dan Qoder menjawab
  `112` — artinya model itu **butuh kredit** untuk akun tersebut, bukan bahwa
  key-nya salah.

## Test

- 8 test baru: `112` dan `pricingUrl` sebagai kuota, `110` harian, penolakan
  `10605`/frequency/site-wide tetap non-kuota, dan regresi pada limit harian
  biasa.
- Suite: **2916 lulus**, 0 regresi baru.

# v0.5.82.4 (2026-10-22)

## Perbaikan penting

- **Qoder `dfmodel_v41` — fallback ke peta model statis.** Qoder CLI menampilkan
  **DeepSeek-Flash (`dfmodel_v41`)**, tetapi katalog API akun belum
  mengeksposnya, sehingga `getQoderModelConfig` mengembalikan `null` dan executor
  menolak secara lokal:

  > qoder: model_config for "dfmodel_v41" not yet known

  `QODER_MODEL_MAP` sudah mengenal key tersebut, jadi saat katalog meleset
  sekarang dipakai konfigurasi minimal (200K input / 64K output) dan request
  tetap dikirim. Upstream yang memutuskan — error asli dari Qoder jauh lebih
  berguna daripada penolakan lokal, dan model langsung berfungsi begitu Qoder
  mengeksposnya.

- **Antigravity `400` kini menyebut penyebabnya.** Google menjawab
  `Bad request` dan menaruh alasan sebenarnya di
  `error.details[].fieldViolations`. Parser hanya membaca `error.message`,
  sehingga log tidak memberi petunjuk apa pun. Sekarang field violation ikut
  ditampilkan.

## Catatan

- Katalog Qoder diambil dari `/algo/api/v2/model/list` — endpoint yang sama
  dipakai CLI resmi. Model ber-`enable:false` tetap di-cache karena chat masih
  menerimanya meski disembunyikan di IDE.
- `bzl/beam` dan `bzl/glyph-cluster` adalah **combo**, bukan model BazaarLink.

## Test

- 7 test baru: fallback peta statis, konfigurasi minimal, penolakan key tak
  dikenal, pembacaan `fieldViolations`, dan verifikasi endpoint katalog.
- Suite: **2910 lulus**, 0 regresi baru.

# v0.5.82.3 (2026-10-22)

## Perbaikan penting

- **Qoder `10605` — hormati jeda dari provider.** Body-nya membungkus JSON tiga
  tingkat, jadi tidak ada yang membaca payload aslinya. `isQueued: true` membawa
  `retryAfterSeconds: 30`, tetapi error-nya jatuh ke backoff generik dan model
  dikunci **120 detik** — empat kali lebih lama dari yang diminta provider.
  `parseError` sekarang membuka envelope bersarang dan mengembalikan `429`
  dengan jeda yang disebut provider.

- **Antigravity `400 Bad request` bukan salah akun.** Google menolak payload
  yang tidak valid **sebelum** melihat akun mana yang meminta, sehingga semua
  akun mengembalikan `400` yang sama. Dulu `chat.js` mengunci tiap akun 30 detik
  satu per satu. Sekarang ditandai `fatal` sehingga request langsung
  dikembalikan tanpa memarkir pool.

## Catatan

- **`qoder/dfmodel_v41` belum ada di katalog upstream.** Kode sudah benar
  (fetch katalog + force refresh); model itu memang belum dirilis Qoder untuk
  akun tersebut. `dfmodel` biasa berjalan normal.
- `bzl/beam` dan `bzl/glyph-cluster` adalah **combo**, bukan model BazaarLink —
  keduanya fallback ke `antigravity/gemini-3.8-flash`.

## Test

- 10 test baru: pembacaan `retryAfterSeconds`, fallback 30 detik, `modelKey`
  dari envelope terdalam, penanganan error biasa, `400` fatal di antigravity,
  dan urutan cek di `chat.js`.
- Suite: **2903 lulus**, 0 regresi baru.

# v0.5.82.2 (2026-10-22)

## Perbaikan penting

- **Limit kapasitas global tidak lagi merotasi akun.** BazaarLink membalas
  `429` dengan `code: "free_global_rate_limited"`:

  > Free models share a limited site-wide capacity and it is currently full —
  > this is not your personal quota. Retry after 30 seconds.

  Limitnya ada di **situs**, bukan di key. Semua akun menerima jawaban yang sama.
  Tapi router tetap menelusuri pool: Key 4, Key 3, Key 2, Key 1 dikunci 4 detik
  satu per satu, lalu muncul `all 12 accounts locked` — padahal tidak ada satu pun
  key yang bermasalah.

  `globalCapacityLimit()` sekarang mendeteksi tanda site-wide dan mengambil
  petunjuk retry dari provider (default 30 detik, maksimum 300 detik). `chat.js`
  memeriksanya **sebelum** `markAccountUnavailable` dan langsung mengembalikan
  `429` dengan jendela waktu tersebut.

- **Limit site-wide bukan kuota pribadi.** `isQuotaExhaustedError` dulu
  mengklasifikasikannya sebagai kuota habis karena body-nya memuat kata "quota"
  (padahal kalimatnya justru "this is not your personal quota"). Akibatnya semua
  key diparkir sampai batas bulan kalender. Sekarang dikecualikan.

## Test

- 10 test baru: deteksi site-wide, pembacaan petunjuk retry, default 30 detik,
  pengabaian 429 biasa, pengabaian status non-429, dan `chat.js` memeriksa
  global limit sebelum mengunci akun.
- Suite: **2891 lulus**, 0 regresi baru.

# v0.5.82.1 (2026-10-22)

## Perbaikan penting

- **Error request-level tidak lagi mengunci akun.** Satu prompt 1.054.321 token
  (limit 1.048.576) memicu dua bug sekaligus:

  **`11115` "prompt is too long"** dianggap error provider biasa, jadi `chat.js`
  memanggil `markAccountUnavailable` dan router menelusuri **semua 18 akun**,
  mengunci tiap-tiap 30 detik. Prompt yang sama gagal di semua akun, jadi loop
  itu tidak akan pernah berhasil.

  **`11128` "request illegal"** tidak cocok dengan sinyal quota mana pun,
  sehingga jatuh ke backoff generik dan naik sampai **`modelLock` 1800 detik**
  pada akun yang sehat.

  Keduanya sekarang bertanda `fatal: true`, dan `chat.js` langsung mengembalikan
  error **sebelum** `markAccountUnavailable` — tidak ada akun yang dikunci.

- **Urutan klasifikasi diperbaiki.** Body `11140` juga membawa
  `msg: "request illegal"`, jadi pengecekan restriksi akun sekarang dijalankan
  **lebih dulu**; kalau tidak, cabang `11128` akan menelannya dan klasifikasi
  tingkat akun hilang.

- **Field `fatal` sebelumnya hilang di tengah jalan.** `parseUpstreamError` dan
  `createErrorResult` hanya meneruskan field yang dikenal, sehingga `fatal` tidak
  pernah sampai ke `chat.js`. Keduanya sekarang meneruskan `fatal` dan
  `accountRestricted`.

## Test

- 17 test baru: `11115` fatal + tidak ada `resetsAtMs`, `11128` fatal tanpa
  cooldown panjang, `11140` menang atas `11128`, `chat.js` mengecek `fatal`
  sebelum `markAccountUnavailable`, dan plumbing `fatal` di
  `parseUpstreamError`/`createErrorResult`/`chatCore`.
- Suite: **2883 lulus**, 0 regresi baru.

# v0.5.82.0 (2026-10-22)

## CodeBuddy Intl — akun tidak lagi mudah di-restrict

Error `11140` ("Your account has been restricted due to unusual activity") adalah
gate **berbeda** dari `11128` (channel verification). Request-nya valid; yang
di-flag adalah **akunnya**. Muncul ketika pola request terbaca sebagai automation.

Penyebabnya: executor hanya mengirim **6 header statis**, sementara CLI resmi
2.170.0 mengirim **~30**. Header yang hilang:

| Kelompok | Header |
|---|---|
| SDK fingerprint | `X-Stainless-Lang`, `-Package-Version`, `-OS`, `-Arch`, `-Runtime`, `-Runtime-Version`, `-Retry-Count`, `-Helper-Method` |
| Identitas agent | `X-Agent-Intent: craft`, `-Purpose: conversation`, `-Type: ide`, `-Runtime: ide` |
| Identitas klien | `X-Product-Version`, `X-App: cli`, `X-IDE-Version`, `X-Private-Data`, `X-Domain`, `X-Request-ID` |

Tanpa header itu, request tetap lolos `11128` tapi terbaca sebagai pihak ketiga —
yang memicu `11140`.

**Yang diperbaiki:**

- Semua header di atas dikirim, nilainya diambil dari bundle CLI 2.170.0
- `X-Stainless-Arch` mengikuti normalisasi CLI (`x64` → `amd64`, `arm` → `arm32`),
  bukan nilai mentah `process.arch`
- `X-Stainless-OS` mengikuti `normalizePlatform()` (`win32` → `Windows`,
  `darwin` → `MacOS`, `linux` → `Linux`, lainnya `Other:<nama>`)
- Duplikat case (`X-CodeBuddy-Request` + `x-codebuddy-request`) dihapus — dua
  ejaan sekaligus terlihat hand-rolled
- `X-Conversation-Request-ID`, `X-Conversation-Message-ID`, dan `X-Request-ID`
  kini bernilai sama per turn (seperti CLI); `X-Conversation-ID` tetap stabil
  lintas retry
- `11140` diklasifikasi sebagai **restriksi akun**: 403 dengan park 12 jam dan
  `accountRestricted: true`, bukan cooldown 2 menit yang justru menghantam akun
  yang sudah kena flag

> Catatan: ini mencegah akun **baru** kena flag. Akun yang **sudah** di `11140`
> harus melalui banding di CodeBuddy — tidak ada perubahan header yang bisa
> membukanya.

## Qoder — katalog lengkap + DeepSeek V4.1 Flash

- **`dfmodel_v41` (DeepSeek-Flash, gratis)** ditambahkan ke Qoder intl dan CN.
  DeepSeek-V4.1-Flash-1017, 200K context, thinking max.
- Katalog provider **intl** kini sama lengkap dengan CN — 17 model, bukan hanya
  `qfmodel`: tier (`auto`/`lite`/`efficient`/`performance`/`ultimate`), Qwen
  (`qmodel`/`qmodel_latest`/`qmodel_38max`/`qfmodel`), DeepSeek
  (`dfmodel_v41`/`dfmodel`/`dmodel`), Kimi (`kmodel`/`kmodel_latest`), GLM
  (`gmodel`/`gfmodel`), MiniMax (`mmodel`)
- **`10605` bukan billing block lagi.** Balasan `{"isQueued":true}` adalah
  admission queue yang selesai dalam hitungan detik; dulu dianggap billing dan
  memarkir akun sampai reset bulanan
- **Validasi Qoder tidak lagi fetch katalog model.** `resolveQoderModels()` dengan
  `forceRefresh` memanggil endpoint katalog setiap validasi, dan balasan `10605`
  saat model sibuk membuat API key valid terlihat invalid. Sekarang cukup
  pertukaran credential (`isValid = !!resolved?.accessToken`)

## Netlify — deploy CLI saja

Jalur deploy lewat REST API dihapus. Dia berulang kali menghasilkan pool yang
menunjuk relay yang tidak pernah tersimpan: pada site baru `required_functions`
bisa kosong, upload dilewati, deploy tetap lapor `ready`, dan URL fungsi 404.

- **Pre-flight check**: modal memeriksa apakah `netlify-cli` tersedia sebelum
  kamu klik Deploy. Tiga status: memeriksa / terpasang / belum terpasang
- Kalau belum ada, tampil perintah `npm i -g netlify-cli` dengan tombol salin dan
  tautan panduan resmi Netlify
- **Pembersihan otomatis**: install yang mati di tengah (OOM, timeout 10 menit)
  meninggalkan `node_modules` setengah jadi + lockfile yang tidak cocok. Sisa itu
  sekarang dihapus sebelum install ulang, dan lagi setelah gagal
- npm yang `exit 0` tapi binary tidak ada (postinstall dilewati, disk penuh)
  sekarang dianggap gagal, bukan sukses palsu
- Nama site yang sudah dipakai otomatis dapat suffix acak, tidak lagi
  menggagalkan deploy
- `netlify-cli` tetap **bukan** dependency `npm i -g panrouter` — hanya
  ter-install saat Deploy pertama, ke `~/.9router/runtime/`, jadi RAM tidak
  terpakai kalau fitur ini tidak dipakai

## Quota — block tidak hilang saat update

- **`CACHE_BLOCK` Antigravity bertahan setelah restart/update.** Bucket yang
  exhausted (`remainingPercentage: 0` + `resetAt` di masa depan) dicerminkan ke
  KV store dan dipulihkan saat startup. Sebelumnya state hanya di `Map` memori,
  jadi update menghapusnya dan akun yang masih diblokir langsung dicoba lagi
- **Rate limit frekuensi bukan quota habis.** Pesan `6004` berbunyi "usage
  exceeds frequency limit ... will reset at ..." — kata "limit" membuatnya
  diklasifikasi quota, lalu diparkir ke kalender `MONTHLY` (tanggal 1 bulan
  depan). Sekarang `frequency limit` / `rate limit` / `too many requests`
  dideteksi lebih dulu dan lewat jalur backoff biasa

## Log console — bisa difilter dan di-pause

- Checkbox **"Hide refresh logs"** (aktif default) menyembunyikan
  `TOKEN_REFRESH` dan `BG_TOKEN_REFRESH`
- **Pause / Resume**: stream SSE tetap buffering saat pause, dan resume
  mem-flush semuanya — tidak ada yang hilang. Auto-scroll berhenti saat pause
- Dropdown tag (dibangun dari tag yang ada di buffer) + filter teks
- Server: `LOG_SUPPRESS_TAGS` dan `LOG_ONLY_TAGS` di `.env`. `error()` sengaja
  **tidak pernah** disaring

## Auto-ping CodeBuddy

- Model auto-ping kini bisa dipilih dari dashboard — **satu pilihan untuk semua
  akun**, disimpan di `codebuddyIntlAutoPing.model`
- Default `fast-model` (alias generik semua tier), dengan rantai fallback
  `default-model` → `balanced-model` bila ditolak karena model (`11158`/`11101`)
- `gpt-5.6-luna` yang dulu di-hardcode tidak bisa dipakai akun
  `personal_free_user` dan menggagalkan seluruh ping

## Perbaikan lain

- `@aws-sdk/credential-providers` yang opsional tidak lagi mematahkan build —
  literal `import()` membuat webpack resolve saat build, dan karena
  `executors/index.js` menarik `bedrock.js` ke semua route, satu dependency
  opsional hilang menjatuhkan `/v1/models`, `/models`, dan root layout
- Provider device-code yang tidak pernah bisa login (`minimax-code`,
  `minimax-code-global`, `muse`, `nous`, `qoder-cn`, `glm`) kini terdaftar di
  list device-code modal; sebelumnya memilih provider itu jatuh ke cabang
  authorization-code
- GLM Coding: `authModes: ["apikey", "oauth"]` agar jalur OAuth Z.ai bisa
  dijangkau dari UI
- CodeBuddy CN: `kimi-k2.8-preview` masuk (300K/131072), `kimi-k2.6`,
  `kimi-k2.7`, `glm-5v-turbo` keluar
- Golden snapshot test tidak lagi menyimpan UUID acak per request
- Tag JSX `</div>` yatim yang menggagalkan build di halaman proxy-pools

## Test

- Suite: **2873 lulus**, 0 regresi baru
- Test baru antara lain: header identity CodeBuddy (termasuk 7 kombinasi
  platform/arch), klasifikasi `11140` vs `6004`, `10605` queue vs billing,
  persistensi CACHE_BLOCK, pembersihan install netlify-cli, kontrol log console,
  dan integritas JSX halaman proxy-pools

# v0.5.81.1 (2026-10-21)

## Perbaikan

- **Qoder 10605 (`isQueued`) dianggap billing block → akun diparkir sampai bulan depan.**

  Upstream membalas:

  ```json
  403 {"code":"10605","message":"{\"isQueued\":true,\"modelKey\":\"qfmodel\",
       \"queueCount\":0}"}
  ```

  `isBillingBlock()` mencocokkan kode `10605`, jadi executor mengembalikan 403
  keras dan chatCore memarkir koneksi sampai reset bulanan — padahal itu cuma
  **antrean masuk** ("model sedang sibuk, kamu masuk antrean") yang selesai
  sendiri dalam hitungan detik.

  Perbaikan:
  - flag `{"isQueued": true}` sekarang langsung menyimpulkan **bukan** billing
  - kode `10605` tidak lagi dipetakan ke billing (`110` dan `112` tetap billing)
  - regex legacy tidak lagi memuat `10605`

- **Validasi Qoder tidak lagi fetch katalog model.**
  `resolveQoderModels()` memanggil endpoint katalog dengan `forceRefresh`, yang
  membalas `10605` setiap kali model sedang sibuk — membuat API key yang valid
  terlihat tidak valid. Daftar model di registry sudah statis, jadi cukup
  pertukaran credential untuk membuktikan key-nya bekerja:

  ```js
  isValid = !!resolved?.accessToken
  ```

## Test

- `qoder-billing.test.js` diperbarui dua arah: `10605` dan `isQueued` **bukan**
  billing, sedangkan `110`/`112`/`pricingUrl` tetap billing. Frame antrean tidak
  lagi menghasilkan 403 keras.
- 7 test baru di `qoder-queue-vs-billing.test.js`.
- Suite: **2824 lulus**, 0 regresi baru.

# v0.5.81.0 (2026-10-21)

## Fitur

- **Kontrol log console: sembunyikan refresh token, filter, dan pause.**
  Log `TOKEN_REFRESH` / `BG_TOKEN_REFRESH` muncul di setiap tick dan menenggelamkan
  baris request yang sebenarnya ingin dibaca.

  **Dua lapis kontrol:**

  **1. Server** (`src/sse/utils/logger.js`) — lewat `.env`:
  - `LOG_SUPPRESS_TAGS` — daftar tag yang disembunyikan, default
    `TOKEN_REFRESH,BG_TOKEN_REFRESH`. Kosongkan untuk menampilkan semua lagi.
  - `LOG_ONLY_TAGS` — allow-list yang menimpa suppress list, berguna untuk
    memantau satu subsistem saja (mis. `CHAT,AUTH`).
  - Berlaku untuk `line`/`debug`/`info`/`warn`. **`error` sengaja tidak pernah
    disaring** — error harus selalu sampai ke operator.

  **2. Dashboard** (`/dashboard/console-log`):
  - checkbox **"Hide refresh logs"**, aktif secara default
  - **Pause / Resume** — stream SSE tetap buffering saat pause, dan resume
    mem-flush semua yang masuk selama pause, jadi tidak ada yang hilang.
    Auto-scroll juga berhenti saat pause supaya tampilan tidak bergerak.
  - dropdown **tag** yang dibangun otomatis dari tag yang ada di buffer
  - filter teks bebas
  - penghitung live / shown / hidden

  `.env.example` sudah mendokumentasikan kedua variabel.

## Test

- 9 test baru: logger menyembunyikan tag refresh secara default, membaca kedua
  env, menerapkan filter ke line/debug/info/warn, dan **tidak** menyaring error;
  UI punya pause yang buffering, hide-noise aktif default, filter tag + teks,
  auto-scroll berhenti saat pause, dan penghitung hidden.
- Suite: **2809 lulus**, 0 regresi baru.

# v0.5.80.1 (2026-10-20)

## Perbaikan penting

- **Rate limit frekuensi salah dianggap quota habis → akun diparkir sampai bulan depan.**

  CodeBuddy 6004 membalas:

  ```
  usage exceeds frequency limit, but don't worry, your usage will reset at
  2026-10-19 15:00:56  (reset after 12m 22s)
  ```

  Pesan itu mengandung kata `limit`, dan daftar sinyal quota punya entri seperti
  `daily limit`, sehingga `isQuotaExhaustedError()` menganggapnya **quota habis**.
  `auth.js` lalu memakai fallback kalender `MONTHLY` milik provider — tanggal 1
  bulan berikutnya — dan menampilkannya di dashboard sebagai:

  ```
  Quota exhausted — resets 2026-10-31T16:59:59.000Z
  ```

  Tanggal itu **bukan dari upstream**. Itu `2026-11-01T00:00:00Z` dikurangi 1ms,
  alias batas bulan WIB. Padahal akunnya masih melayani model lain dengan normal,
  persis seperti yang terlihat di log.

  Perbaikan: deteksi kata `frequency limit` / `rate limit` / `too many requests`
  **sebelum** sinyal quota generik, sehingga pesan yang menyebut quota sekaligus
  frekuensi tidak salah kelas. Rate limit frekuensi sekarang lewat jalur backoff
  biasa (menit), bukan parkir berhari-hari.

## Test

- 6 test baru: pesan 6004 bukan quota, rate-limit generik bukan quota, pesan
  campuran "quota + frequency" bukan quota, sedangkan refusal asli
  ("Credits exhausted", "daily free limit reached", "Individual quota reached")
  tetap terdeteksi. Satu test mengunci matematika kalender bulanan supaya tanggal
  `2026-10-31T16:59:59Z` tidak pernah muncul tanpa sengaja.
- Suite: **2801 lulus**, 0 regresi baru.

# v0.5.80.0 (2026-10-20)

## Fitur

- **Pilih model auto-ping CodeBuddy dari dashboard.** Sebelumnya model di-hardcode.
  Sekarang ada dropdown **"Auto-ping: ..."** di samping judul *Available Models*
  pada halaman provider CodeBuddy — **satu pilihan untuk semua akun**.

  Nilainya disimpan di `codebuddyIntlAutoPing.model`. Kosong = pakai default
  bawaan (`fast-model`).

  Urutan pemilihan model di service:
  1. `codebuddyIntlAutoPing.model` (dropdown)
  2. `C.pingModel` (`fast-model`)
  3. `pingModelFallbacks` — hanya dicoba kalau ditolak karena model
     (11158 / 11101 / "not allowed for user type")

  Fallback selalu ditambahkan di belakang, jadi memilih model yang ter-gate plan
  tidak akan menggagalkan ping seperti kasus `gpt-5.6-luna` sebelumnya.

  Dropdown hanya muncul untuk provider yang mendukung auto-ping
  (`claude`, `codex`, `codebuddy-intl`).

## Test

- 6 test baru: service membaca `cfg.model`, satu model global tanpa pin per-akun,
  fallback tetap ada setelah model pilihan, dropdown ada di halaman provider,
  state menyimpan `model`, dan dropdown hanya muncul untuk provider yang cocok.
- Suite: **2800 lulus**, 0 regresi baru.

# v0.5.79.1 (2026-10-20)

## Perbaikan

- **Auto-ping CodeBuddy gagal terus karena model terlarang.**
  Ping harian memakai `gpt-5.6-luna` yang di-hardcode, padahal akun gratis
  tidak boleh memakainya:

  ```
  400 {"code":11158,"msg":"model [gpt-5.6-luna] is not allowed for
       user type [personal_free_user]"}
  ```

  Akibatnya setiap ping gagal dan aktivitas harian tidak pernah tercatat.

  Perbaikan:
  - `pingModel` sekarang `fast-model` — alias murah generik yang bisa dipakai
    semua tier akun
  - `pingModelFallbacks` (`default-model`, `balanced-model`) dicoba berurutan
  - fallback hanya jalan kalau penolakannya karena model (11158 / 11101 /
    "not allowed for user type"); kalau 429 credits exhausted langsung berhenti
    karena model lain tidak akan menolong

## Catatan audit

- **Cline block harian sudah benar dan sudah persist.** `quotaWindowFor("cline")`
  = `DAILY` reset `00:00 UTC`; karena tidak ada usage reader untuk Cline, jalur
  reset memakai kalender, lalu ditulis sebagai `modelLock_<model>` di tabel
  `connections` — jadi bertahan lintas restart/update.
- Provider lain (TokenHarbor, Claude, Codex, Kiro, GLM, Grok CLI, Kimi,
  CodeBuddy, Qoder) juga lewat jalur `modelLock_*` yang sama.
- Antigravity satu-satunya yang dulu in-memory; sudah ditutup di v0.5.79.0.

## Test

- 5 test baru untuk pemilihan model ping: alias bukan model ter-gate, ada
  fallback chain, retry hanya saat model-gating, dan 429 langsung berhenti.
- Suite: **2794 lulus**, 0 regresi baru.

# v0.5.79.0 (2026-10-20)

## Fitur

- **`CACHE_BLOCK` Antigravity bertahan setelah update / restart.**
  Sebelumnya status quota hanya hidup di `Map` memori:

  ```
  ⚠️ [AG_QUOTA] 58053aac | UPSTREAM_429 claude-sonnet-4-6 — quota exhausted;
     CACHE_BLOCK until 2026-10-26T00:20:34.000Z
  ```

  Begitu PanRouter di-update, Map itu hilang. Akun yang masih diblokir sampai
  26 Oktober langsung dicoba lagi, kena 429 lagi, dan strike counter mulai dari
  nol — persis yang bikin log penuh 429 berulang setelah update.

  Sekarang bucket yang exhausted (`remainingPercentage: 0` + `resetAt` di masa
  depan) dicerminkan ke KV store (scope `ag_quota`) dan dipulihkan saat startup
  lewat `initializeApp`. Entry yang `resetAt`-nya sudah lewat dibuang dan
  barisnya dihapus otomatis.

  **Sengaja tidak dipersist:**
  - bacaan sehat (`remainingPercentage > 0`) — akan refresh sendiri
  - strike block 15 menit — sintetis, memang harus mulai dari nol

  Tulis KV bersifat fail-open: error database dicatat, tidak pernah memblokir
  request.

  Catatan: `modelLock_*` yang dipakai CodeBuddy/Claude 429 memang sudah persist
  di DB lewat `connectionsRepo`. Antigravity satu-satunya yang masih in-memory.

## Test

- 5 test baru: restore setelah restart, buang entry kadaluarsa + bersihkan baris,
  tidak pernah restore bacaan sehat, persist bacaan exhausted lalu bersihkan saat
  sehat, dan tetap aman saat KV error.
- Suite: **2784 lulus**, 0 regresi baru.

# v0.5.78.4 (2026-10-20)

## Perbaikan penting

- **CodeBuddy Intl 400 code 11128 "request illegal"** — sejak 2026-10-15 gateway
  intl (`www.codebuddy.ai`) menolak semua request yang tidak membawa header family
  `X-Conversation-*`. Semua akun (termasuk auto-ping) kena 400.

  Header yang ditambahkan:

  | Header | Nilai |
  |---|---|
  | `X-Conversation-ID` | UUID stabil dari session key / opening user message |
  | `X-Conversation-Request-ID` | UUID segar per request |
  | `X-Conversation-Message-ID` | UUID segar per message |

  `X-Conversation-ID` di-derive secara deterministik (sha1 UUID-v5-shaped) dari
  `session_id` / `prompt_cache_key` / `conversation_id` body jika ada, lalu dari
  isi pesan user pertama, lalu fallback random. Ini membuat ID stabil lintas retry
  satu turn dan lintas failover akun.

  Ported dari upstream 9router PR #4928 / #5032. Diverifikasi A/B live: header
  tidak ada → 400, header ada → 200 SSE.

## Test

- Test baru (5 kasus): header selalu hadir, conversation ID stabil lintas retry,
  prioritas session_id > pesan, support typed-block content, fallback random.

# v0.5.78.3 (2026-10-19)

## Perbaikan penting

- **`@aws-sdk/credential-providers` yang opsional tidak lagi mematahkan build.**
  Import-nya ditulis sebagai literal `import("@aws-sdk/credential-providers")`,
  jadi webpack mencoba me-resolve saat **build**. Kalau paket itu tidak ada:

  ```
  Module not found: Can't resolve '@aws-sdk/credential-providers'
  ```

  Karena `executors/index.js` menarik `bedrock.js` ke **setiap** route, satu
  dependency opsional yang hilang membuat:

  - `GET /v1/models` → **500**
  - `GET /models` → **500**
  - root layout (`src/app/layout.js`) → gagal compile

  Bukan cuma Bedrock yang rusak — seluruh aplikasi.

  Sekarang specifier di-resolve lewat `createRequire(import.meta.url)`, pola yang
  sudah dipakai untuk `netlify-cli`. Specifier-nya tetap di `awsConstants.js`,
  jadi tidak ada literal tersisa di module graph. `serverExternalPackages` tetap
  menjaga paket asli di luar bundle saat runtime, tempat profile/SSO memuatnya
  secara normal.

  Mode static-key tidak pernah menyentuh SDK, jadi jalur umum tidak berubah.
  Mode profile tanpa paket sekarang gagal dengan pesan yang sudah ada
  ("Install it, or switch this connection to static accessKeyId/secretAccessKey
  credentials") alih-alih menjatuhkan aplikasi.

  Diverifikasi dengan paket **dihapus sementara** dari `node_modules`: suite
  tetap lulus dan module graph tetap resolve.

## Test

- Test baru mengunci: tidak boleh ada literal `import()` untuk SDK opsional,
  specifier harus tetap di config, mode static tidak boleh memanggil loader, dan
  mode profile tanpa paket harus memberi error yang bisa ditindaklanjuti.
- Suite: **2774 lulus**, 0 regresi baru.

# v0.5.78.2 (2026-10-19)

## Perbaikan

- **GLM Coding: jalur login OAuth tidak bisa dijangkau dari UI.** Registry-nya
  `category: "apikey"` tanpa `authModes`, jadi halaman provider menghitung
  `isOAuth = false` dan hanya menawarkan modal API key. Provider OAuth Z.ai
  (`src/lib/oauth/providers/glm.js`, flow CLI polling) sudah lengkap dan bahkan
  terdaftar di list device-code modal — tapi tidak ada jalan untuk memulainya.

  Sekarang `authModes: ["apikey", "oauth"]` + `hasOAuth: true`, jadi halaman
  membuka modal OAuth dan flow CLI polling-nya jalan.

- **`nous` sudah benar** — dilaporkan bermasalah, tapi verifikasi menunjukkan
  `category: "freeTier"` dengan `authModes: ["oauth", "apikey"]`. Halaman
  provider menerima keduanya (`authModes.includes("oauth")`), dan `nous` sudah
  ada di list device-code modal sejak v0.5.78.1. Tidak ada perubahan kode.

## Test

- Test rantai penuh baru: untuk **setiap** provider device-code, pastikan
  benar-benar bisa dijangkau dari UI (`category` oauth/free, atau `authModes`
  memuat oauth) — bukan sekadar terdaftar di list modal. Test inilah yang
  menemukan bug GLM di atas.
- Suite: **2769 lulus**, 0 regresi baru.

# v0.5.78.1 (2026-10-19)

## Perbaikan

- **OAuth modal: provider device-code yang tidak pernah bisa login.**
  `minimax-code-global` mendeklarasikan `flowType: "device_code"` dan terdaftar di
  provider index, tapi tidak ada di list `deviceCodeProviders` milik modal —
  jadi memilih provider itu jatuh ke cabang authorization-code dan login tidak
  pernah mulai.

  Audit yang sama menemukan empat provider lain dalam kondisi identik, jadi
  semuanya sekalian diperbaiki:

  | Provider | PKCE |
  |---|---|
  | `minimax-code` | ya (code challenge) |
  | `minimax-code-global` | ya (code challenge) |
  | `muse` | tidak |
  | `nous` | tidak |
  | `qoder-cn` | tidak |
  | `glm` | tidak |

  Keenamnya sekarang ada di `deviceCodeProviders`. Lima yang tanpa PKCE juga
  masuk `noPkceDeviceProviders` di route supaya `requestDeviceCode` dipanggil
  tanpa challenge; `minimax-code` tetap lewat jalur PKCE.

## Test

- Test baru memastikan **setiap** file provider yang mendeklarasikan
  `flowType: "device_code"` benar-benar bisa dijangkau dari modal, sehingga bug
  sekelas ini tidak bisa lolos lagi.
- Suite: **2740 lulus**, 0 regresi baru.

# v0.5.78.0 (2026-10-19)

## OpenCode Free — katalog diperbarui

Model lama sudah dipensiunkan upstream. `muse-spark-1.2-contributor-free`,
`muse-spark-1.3-contributor-free`, dan `union-alpha` sekarang balas
**410 ModelDeprecated**. Katalog diganti dengan 10 model free yang benar-benar
dilayani (diprobe live dari `GET /zen/v1/models`):

| Model | Keterangan |
|---|---|
| `big-pickle` | 200k context |
| `space-bunny-free` | 1M context, vision + video |
| `deepseek-v4.1-flash-free` | 1M context, reasoning |
| `glm-5.3-flash-free` | 1M context, reasoning |
| `mimo-v2.6-flash-free` | 1M context, reasoning |
| `longcat-2.5-preview-free` | 1M context |
| `nemotron-3.5-lightning-free` | 1M context |
| `nemotron-3.5-super-vl-free` | 1M context, vision |
| `jev-1.13-free` | 200k context |
| `beam-free` | 1M context, vision |

`test` sengaja tidak dimasukkan — itu fixture upstream, bukan model.

`RESPONSES_MODELS` / `MESSAGES_MODELS` sekarang kosong: semua model katalog
memakai jalur chat. `isMuseSparkModel()` tetap dipakai sehingga id passthrough
`muse-spark-*` masih diarahkan ke `/responses` kalau upstream menghidupkannya lagi.

## OpenCode Free — 403 karena IP proxy di-flag

Gate free-tier OpenCode membalas `403 FreeTierError` kalau request keluar dari
IP yang sudah ditandai. Transport-nya sendiri sukses, jadi fallback proxy yang
berbasis `catch` tidak pernah jalan — setiap retry tetap lewat proxy yang sama
dan 403 terus berulang sampai proxy diganti manual.

Sekarang respons 403 berisi penanda `FreeTierError` dari jalur proxy **diputar
ulang sekali lewat egress langsung**. `strictProxy: true` tetap tidak pernah
keluar dari jalur yang dikonfigurasi, dan body stream yang sudah terpakai tidak
dikirim ulang.

Ported dari PR upstream 9router #4988.

> Catatan: kalau IP publikmu sendiri juga di-flag (bukan cuma proxy), replay
> langsung tetap 403. Dalam kasus itu pakai proxy pool dengan IP bersih.

## Test

- `executor-const-guard` dan `opencode-free-tool-choice` sekarang menguji
  endpoint v2 `/inference/v1` dan fingerprint `read`/`shell`, bukan quartet
  `bash`/`glob`/`grep`/`read` yang sudah tidak dipakai. Keduanya sudah gagal
  sebelum perubahan ini.
- Suite: **2734 lulus**, 0 regresi baru (20 file yang masih gagal sudah gagal
  sebelum perubahan ini).

# v0.5.77.0 (2026-10-19)

## Breaking

- **FreeBuff dihapus seluruhnya.** Upstream sudah tidak bisa diproxy lagi — setiap
  request balik 401/409. Yang dihapus:
  - provider registry, executor, tool map, usage probe, OAuth provider
  - auto-streak harian (`freebuffAutoStreak` + konfigurasinya)
  - UI model-pin di ConnectionRow + handler `PUT /api/providers/[id]`
  - entri di `quotaWindows`, `OAuthModal`, `noPkceProviders`, catalog capabilities
  - `FREEBUFF_WAITING_ROOM` (budget antrean 428)
  - 5 file test khusus FreeBuff

  `wafGuard` **tidak** disentuh — daftar host-nya melindungi node proxy, bukan
  provider ini. Koneksi FreeBuff yang sudah ada di DB jadi tidak terpakai; hapus
  manual dari dashboard.

## Perbaikan

- **CodeBuddy Intl — tombol Test koneksi** sekarang memakai validasi `tokenExists`
  yang sama dengan CodeBuddy CN. Sebelumnya provider ini tidak dikenali dashboard
  sehingga test koneksi tidak pernah jalan.
- **CodeBuddy CN — catalog 2026-09-30**: tambah `kimi-k2.8-preview`
  (300k context / 131072 output), buang `kimi-k2.6`, `kimi-k2.7`, dan
  `glm-5v-turbo` yang sudah tidak dipublikasikan server.
- **DeepSeek V4.1 Flash (CodeBuddy CN)** — level reasoning jadi `low`/`high`/`max`.
  Blok provider-specific dipindah ke atas aturan generik `*deepseek-v4.*` karena
  `PATTERN_THINKING` memakai `find()` sehingga aturan generik (6 level) menutupi
  aturan khusus provider.

## Test

- Golden header snapshot tidak lagi menyimpan UUID acak per request
  (`X-Mavis-Session-Id` dari MiniMax). Sebelumnya test gagal bergantian setiap
  run karena nilai UUID baru selalu ditulis ke snapshot.
- `quota-window` dan `error-rules-daily-quota` tidak lagi menguji perilaku
  FreeBuff (provider-nya sudah tidak ada).
- Baseline alias + providers di-regenerate.
- Suite: **2727 lulus**, 0 regresi baru dibanding HEAD (22 file yang masih gagal
  sudah gagal sebelum perubahan ini — tercatat di `known-fails.txt`).

# v0.5.76.0 (2026-10-19)

## Provider Baru

- **Nous Research** — OAuth Device Code + agent key minting, 8 model free-tier, thinking format `nous` (low/medium/high), token refresh otomatis
- **Dahl Inference** — OpenAI-compatible node (GLM-5.3-Flash, DeepSeek-V4-Flash, MiniMax-M2.7)
- **Muse (Meta Model API)** — dual auth OAuth/apikey, `museHeaders` hook, transport Chat + Responses
- **MiniMax Code CN + Global** — OAuth PKCE, single-use refresh dedup, normalisasi 402/403 → 429
- **TinyFish** — webSearch + webFetch provider (x-api-key)
- **v1m (System One)** — decision engine (calibrated model, systemoneConfig)
- **Qoder CN** — region-aware support (gateway.qoder.com.cn); intl behaviour tidak berubah
- **GLM Coding OAuth** — Z.ai CLI polling flow (cliInit → cliPoll → businessLogin → coding-plan API key)
- **Amazon Bedrock** — SigV4 signing, AWS EventStream decoder, static key + profile/SSO; `bedrock-xai` alias `br`/`brx`
- **Gemini 4 Argon** — gemini-level thinking LOW/MEDIUM/HIGH only (menolak "minimal"), `defaultLocation: global`, vertex API-key project/location

## OpenCode

- **Free tier fingerprint v2**: pindah `/zen/v1` → `/inference/v1`, UA `opencode/latest/2.0.26/cli`, header `x-opencode-session-id`/`x-session-affinity`, ganti tool quartet → `read`/`shell` schema verbatim CLI v2
- **Zen multi-turn**: inject `reasoning_content` placeholder agar tidak 400
- **Go DeepSeek**: drop `response_format` (upstream menolaknya)
- **Go Haiku 5.5**: route ke `/messages` + adaptive thinking
- Bukti live: `POST /inference/v1/chat/completions` → HTTP 200 SSE ✓

## Fitur

- **Gemini Live STT**: WebSocket `bidiGenerateContent`, audio naik sebagai `realtimeInput` mediaChunks, server push `inputTranscription`
- **Claude reset grants**: `consumeClaudeResetGrant()` + rute `/api/usage/[id]/claude-reset`, usage cache 5m + 429 cooldown 3m
- **Quota tracker frequency limit**: baris `Frequency Limit — <model>` muncul otomatis di quota tracker ketika model terkena 429 per-model (e.g. CodeBuddy Intl deepseek-v4.1-flash gratis); countdown reset time tampil langsung; mekanisme skip per-model sudah berjalan sejak sebelumnya
- **Model search regex/negasi**: cari model dengan `/pattern/`, `!keyword`, atau kombinasi `claude !haiku`
- **Sembunyikan model terlarang dari /v1/models**: key dengan `limits.models` allowlist tidak melihat model yang tidak diizinkan
- **Anchor ping schedule**: `quotaPingSchedule.js` — slot tetap jam lokal (anchor 09:30, window 5h, 3 slot/hari), grace 30m, `getDuePingSlot`/`getNextPingSlot`
- **Nous Portal routes lengkap**: live catalog dengan prefix `nous/`, test probe via inference kecil, validate route
- **GLM + Zed OAuth modal**: GLM Coding sign-in dari dashboard, Zed auto-import dari IDE keyring

## Dashboard

- **ProviderBarChart + TopModelsChart**: grafik breakdown per-provider dan top model di halaman Usage
- **AutoPingScheduleModal**: konfigurasi anchor/timezone/window/slots per-connection
- **CustomConfigCard**: tambah custom header per-provider dengan blocked-header guard
- **Tooltip portal**: render via `createPortal` + fixed position sehingga tidak ter-clip overflow ancestor
- **Proxy dropdown maxHeight**: menu tidak keluar viewport saat list panjang

## CLI Tools

- 8 route baru: `codewhale`, `codex-profiles`, `crush`, `forge`, `hermes-profiles`, `omp`, `pi`, `smelt` + `resolveApiKey` helper
- **GenericCliToolCard**: card universal untuk tool tanpa card khusus
- Antigravity model aliases diperbarui (Claude Sonnet 5.5, Opus 5.5, Gemini 3.1 Pro high/low)

## Usage & Quota

- **Cursor + CommandCode**: usage reader masing-masing
- **Qoder add-on quota**: baris "Add-on" tampil ketika akun punya grant promo; sentinel 9999-12-31 → "Never expires"
- **Combo presets**: `/api/combos/presets` + `comboPresets.js`
- **Claude usage cache**: dedup per-token 5m, 429 cooldown 3m agar tidak hammer endpoint quota

## Fix Bug (dari upstream 9router)

- **headroom**: hanya warning kalau `messageBytes` DAN `bodyBytes` sama-sama tidak menyusut <5% (sebelumnya false warning saat tool schema besar)
- **usageRepo**: fallback `input_tokens` di live-history 24h (Gemini/embedding tidak lagi 0)
- **claudeMessage.js**: shared module, SSE→JSON path balikin Claude shape yang benar
- **combo**: fallback ke model berikutnya kalau HTTP 200 balik isi kosong (`in_progress`/`incomplete`)
- **Gemini 4**: drop sampling params yang tidak didukung; `functionResponse` diorder terakhir di merged user turn
- **GitHub Copilot embeddings**: pindah ke `api.githubcopilot.com`; ganti `text-embedding-3-large` → `text-embedding-ada-002`
- **nodesRepo**: hapus `customModels` KV saat provider node dihapus

## Internal

- Nous attribution: tag `product=panrouter`, `client=panrouter`, `user=panrouter` untuk akun Portal via openai-compatible node
- Codex CLI bump 0.154.0 → 0.159.0; catalog: tambah GPT-6 family + extended context `[1m]`, hapus gpt-5.5/5.4/5.3-codex-spark yang sudah retired, tambah `gpt-daybreak-blue-latest`/`gpt-reserve`
- Codex auto-ping model: `gpt-5.5` → `gpt-5.6-terra`
- Semua teks "9Router/9router" → "PanRouter" di file yang baru diport

# v0.5.75.32 (2026-10-08)

## Revert ke Baseline v0.5.75.27 + Satukan Free.ai UI

- **Kembalikan seluruh basis kode ke v0.5.75.27**: membatalkan seluruh eksperimen DNS bypass CodeBuddy (realIpResolver, codebuddyFetch) yang memicu OOM dan error routing di VPS. Seluruh sistem kembali ke kondisi stabil v27.
- **Satukan Free.ai di Dashboard**: menyembunyikan provider deprecated `freeai-vl` (`hidden: true`) dari UI Add Connection, sehingga dashboard hanya menampilkan satu provider `freeai` (Free.ai) untuk seluruh model chat, code, dan vision.

# v0.5.75.27 (2026-10-07)

## Netlify Relay Fixed + Lazy CLI Install + Clipboard Fix

- **Netlify pool routing diperbaiki**: pool `type: "netlify"` kini diperlakukan sebagai header-relay (spek sama dengan Vercel/Cloudflare/Deno → `x-relay-target`/`x-relay-path`), bukan HTTP proxy biasa. Menghilangkan `[ProxyFetch] invalid url` (undici menolak URL fungsi `/relay` yang ber-path) dan memastikan request benar-benar lewat relay.
- **Relay function Netlify + guard SSRF minimal**: blokir loopback/metadata/`*.netlify.app` → 403, tetap meneruskan target sah.
- **netlify-cli dimuat lazy saat deploy pertama** (tidak hard-dependency): install otomatis ke `~/.9router/runtime/netlify-cli` + perintah manual tampil di modal; `npm i -g panrouter` kembali ringan (~10 paket).
- **Perbaikan tombol salin di Proxy Pools**: `navigator.clipboard` gagal di http non-https → fallback `execCommand("copy")`, toast jujur sesuai hasil.

# v0.5.75.26 (2026-10-06)

## Netlify CLI Bundled + Free.ai Unified + Antigravity Verify-Hint

- **Netlify CLI kini dependency resmi** (`cli/package.json`): `npm i -g panrouter` otomatis mengunduh netlify-cli; route deploy resolve via `require.resolve("netlify-cli/bin/run.js")` lalu spawn `node run.js` (fallback PATH untuk setup standalone) — menghilangkan `spawn netlify ENOENT` di mesin baru/VPS.
- **Free.ai disatukan jadi satu node** (`freeai`): semua model chat + code + vision (qwen-vl, qwen25-vl, moondream2) dalam satu provider, satu API key. Executor baru me-routing model vision ke `/v1/chat/completions`, chat/code ke `/v1/chat/`. `freeai-vl` ditandai deprecated (kompatibilitas koneksi lama dipertahankan).
- **Antigravity fingerprint diperbarui ke IDE 2.19.1** — User-Agent `antigravity/ide/2.19.1 darwin/arm64` + `X-Client-Version` mengikuti.
- **Link verifikasi akun di console log**: saat `loadProject`/quota mengindikasikan "verify your account / not eligible", router mencetak URL `accounts.google.com/signin/continue?...` (fail-open, tidak menyimpan apa pun).
- **403 kuota Antigravity dilayani seperti 429** (`chat.js`): 403 berisi quota/eligible/verify ikut jalur refresh quota → parkir family bucket + log verifikasi.
- `QUOTA_EXHAUSTED_SIGNALS` + `"exceeded your current quota"` agar 403 kuota tidak jatuh ke cooldown 2 menit.

# v0.5.75.25 (2026-10-05)

## Antigravity Quota Family-Only Routing + Exact Reset Parking

- **Family-only quota routing**: Plus/Free accounts share ONE weekly limit per family. Per-model rows on Plus only mirror that weekly bucket (only Pro/Ultra add a real 5h session). Now the router blocks exclusively on the family buckets:
  - `gemini-*` (termasuk `gemini-3.1-flash-image`) → `gemini_weekly`
  - `claude-*`, `gpt-*` (termasuk `gpt-oss-120b`) → `claude_gpt_weekly`
- **Exact reset from 429 body**: `AntigravityExecutor.parseError` reads `quotaResetTimeStamp` / `quotaResetDelay` / `RetryInfo.retryDelay` from Google's error `details`; chat.js prefers it over the live quota API.
- **Fix 15m strike misclassification**: free-tier accounts have no per-model quota rows, so 429s used to hit the strike breaker (15m CACHE_BLOCK) despite the body saying "Resets in 74h". Now parks until the true weekly reset.
- `QUOTA_EXHAUSTED_SIGNALS` + `isQuotaExhaustedError` recognize "individual quota" / "RESOURCE_EXHAUSTED" / "upgrade your subscription to increase".

# v0.5.75.24 (2026-10-05)

## Netlify Headless CLI Deploy + CodeBuddy Intl Auto-Ping Upgrade

- **Netlify Relay Deploy Engine**:
  - Self-contained headless Netlify CLI runner inside backend (auto-resolved executable, `--auth` headless deploy without terminal login).
  - Real-time line-by-line streaming progress to modal.
  - Fixed template literal regex escape collision in relay function (`target.endsWith('/') ? target.slice(0, -1) : target`).
  - Auto-subdomain conflict retry, 180s timeout headroom, and direct 1-click Netlify Overview links.
- **CodeBuddy Intl Auto-Ping Upgrade**:
  - Model set to `gpt-5.6-luna` (0.14x multiplier, 38% cheaper than fast-model).
  - `pingMaxTokens: 16` to satisfy upstream minimum parameter requirements.
  - Aligned daily cycle boundary to 07:00 WIB (00:00 UTC), covering 07:01 WIB today to 06:58 WIB next morning.
  - Immediate ping on first activation, followed by full 24-hour randomized slot distribution (07:01–06:58 WIB) with zero missed pings.

# v0.5.75.19 (2026-09-29)

## Qoder free model pin + CodeBuddy monthly parking

- Qoder is now intentionally limited to `qd/qfmodel` — **Qwen3.8-Flash (Free)**. Dynamic signed catalog fetches remain internal for `model_config` only and no longer flood dashboard or `/v1/models`.
- Updated Qoder CLI/COSY fingerprint to the locally verified qodercli `1.1.64`; catalog envelope drift does not create a false 30-second account lock.
- CodeBuddy Intl error `14018` / `Credits exhausted` now parks at the recurring Monthly `CycleEndTime`, never generic backoff or a one-shot Bonus Pack expiry.
- Cline `/models` marketplace is no longer exposed; only curated registry pins appear under `cl/`.

# v0.5.75.18 (2026-09-28)

## Codex quota tracker reset

- Bare Codex `429` (`The usage limit has been reached`) now classifies as quota exhaustion rather than a burst limit.
- Router probes the live Codex quota tracker and parks `modelLock_<model>` until `session.resetAt`; structured `usage_limit_reached` + `resets_at` still takes priority.
- No fixed 10-minute retry loop against an exhausted Codex account.

# v0.5.75.17 (2026-09-27)

## Upstream port v0.5.86 → v0.5.91 (12 cherry-picks) + provider baru

- Thinking display: Claude thinking text kembali ke client OpenAI
  (`reasoning_effort`/`reasoning.summary` → `thinking.display: "summarized"`),
  redact-thinking filter saat client minta summary, merge anthropic-beta
  client flags, forward rate-limit headers.
- Tool-result images di-forward ke OpenAI/Kiro/CommandCode upstream
  (bukan "[image omitted]"); Kiro tool names di-restore via _toolNameMap.
- Responses API: output items + usage carried di response.completed.
- commandcode: replay raw byte chunks (NDJSON lines utuh), image native block.
- decloak tool names saat toolNameMap miss; spoofed CLI version 2.1.280 (Opus 5.5).
- Cline: cline-free/* tier gratis di-expose; resolveClinepassModels kembali
  (filter cline-pass/), catalog merge additive, timeout 15s (cold start ~5.7s).
- gemini: guard terminal turns + functionCalls tanpa respon.
- Connection test: generic registry-driven probe (validateUrl + auth scheme)
  untuk provider tanpa case khusus — fix "invalid" di dashboard.
- Provider baru: VYCEAI (`vy`), JustDoWork (`jd`, Anthropic-compatible),
  APIMIX.AI (`am`), Atria Dawn (`at`, multi-transport chat+responses).
- TokenHarbor: 429 free-allowance diparkir sampai reset eksak (parse timestamp
  dari body), bukan backoff — Cline-style.
- Tests: flip it.fails→it untuk 3 bug yang difix port ini; flip sesuai §6.

# v0.5.75.16 (2026-09-24)

## FreeBuff sync + tool-map v2.2

- 3 early-access models dari fork 0.0.180 (deepseek-v4.1-flash, v4.1-pro,
  glm-5.3) + roots MODEL_TO_AGENT senada.
- Dedupe nama tool duplikat di wire (fork #655 parity): first wins, duplikat
  virtualize ke mcp__<name>, restore memetakan balik.

## OpenCode fingerprint + opencode-zen resmi (upstream v0.5.82-0.5.86 port)

- Fingerprint tools (bash/glob/grep/read) pada setiap request Responses +
  restore nama klien (fix 403 FreeTierError dengan client tools).
- opencode-zen (ocz/) resmi: registry + usage service.
- opencode-go reasoning_effort glm-5.3-flash; Muse tool_choice/reasoning fixes.

## Relay lossless header forwarding

- proxyFetch: Headers instance dinormalisasi sebelum spread; vercel-deploy
  meneruskan header mentah dari entries() — relay tidak lagi kehilangan
  auth/content-type di jalur tertentu.

## Xiaomi MiMo V2.6 + server-assisted desktop login

- Model V2.6 + thinking levels; capacity fallback ke mimo-v2.6-flash-free.
- mimoLoginSession + API routes login (alur VPS-friendly).

## Lainnya

- Claude Opus 5.5; refusal stop_reason → content_filter.
- Streaming: abort setelah HTTP 200 kirim error frame in-band.
- Qoder: billing block (code 110), cegah replay signed request.
- Antigravity: drop requestType "agent" (hindari 429 palsu).
- Login page: panduan ssh -L saat password default ditolak dari remote.

# Unreleased

## FreeBuff tool-map v2.2 — duplicate-name dedupe (fork #655 parity)


Ported from `jhopan/freebuff-proxy` (`31931c8e`): strict upstreams
(DeepSeek, Muse Spark, MiMo) reject duplicate wire tool names
("Tool names must be unique"). `sanitizeRequestTools` now keeps the first
occurrence of a name and virtualizes later duplicates to `mcp__<name>`
(still callable — MCP-style names are observe-only upstream);
`restoreResponseToolNames`/stream restore maps them back to the client's
name. Two new unit tests pin the behavior, including full-Hermes-set
name-unique + detector-clean.
## Fixes
- **Qoder**: prevent proxy failures from silently replaying signed inference requests over a direct connection with the same COSY request ID (`403/103 Duplicate request`).
- **Qoder**: return first-frame upstream errors, including `403/103 Duplicate request`, as HTTP failures instead of assistant text; handle fragmented frames and heartbeat prefixes while preserving billing error mapping.

# v0.5.81 (2026-09-18)

# Unreleased

## FreeBuff sync from fork (upstream freebuff 0.0.180)

- Registry: 3 early-access wire ids pinned — `deepseek/deepseek-v4.1-flash`,
  `deepseek/deepseek-v4.1-pro`, `z-ai/glm-5.3` (provisioned tiers; sessions
  admit against their own roots, no picker/quota entries upstream).
- Executor: matching `MODEL_TO_AGENT` roots added (`base2-free-deepseek-v4-1-flash`,
  `base2-free-deepseek-v4-1-pro`, `base2-free-glm-5-3`).

# v0.5.75.15 (2026-09-19)

## New providers (OmniRoute parity + operator-requested gateways)

- **Agnes AI (`agnes/`)** — apikey, `apihub.agnes-ai.com/v1`. Free multimodal
  tier (text/image/video), recurring-uncapped budget; 1.5/2.0/2.5 Flash
  (262k–512k ctx). Key: platform.agnes-ai.com.
- **FreeModel.dev (`fmd/`)** — apikey, `api.freemodel.dev/v1`. One-time
  initial credits over GPT-5.x; live catalog pins gpt-5.6-luna/sol/terra.
  Key: freemodel.dev.
- **OrcaRouter (`orca/`)** — apikey, `api.orcarouter.ai/v1/responses`
  (Responses API). Free pins: deepseek-v4-flash-free, tencent/hy3-free,
  glm-5.3-flash-free, orca/orcaverify-text1.0-free. Key:
  orcarouter.ai/console/token.
- **APInex (`apinex/`)** — apikey, `api.apinex.bond/v1` chat-completions.
  Free vendor prefix `free/`; pins free/glm-5.3-flash. Key: apinex.bond/keys.
- **TokenHarbor (`th/`)** — apikey, `tokenharbor.ai/v1` chat-completions.
  `:free` suffix; pins deepseek-v4.1-flash:free, deepseek-v4-flash:free,
  mimo-v2.5:free. Key: tokenharbor.ai/dashboard/api-keys.

## OpenCode — cloak decoys on every Responses request

muse-1.3 + external tools 403'd (FreeTierError) because the cloak fired
only when tools were empty; `cloakOpencodeTools` is now called
unconditionally on the Responses path (PR #4155 parity, live-verified
200 with 5 external tools).

README: API-key provider count updated to 50+, new gateways listed.

# v0.5.75.14 (2026-09-19)

## OpenCode — free-tier fixes ported + Zen PAYG provider

### OpenCode Free (`oc/`) — all merged upstream fixes
- **Canonical identity**: UA `opencode/1.18.31` (≥1.17 gate) + canonical
  `ses_`/`msg_` id formats; foreign session ids deterministically translated.
- **Stable session per identity** (0c6ab4f9): free-tier quota is accounted
  per session — one long-lived canonical session per connection instead of
  a fresh mint per request (stops 429 FreeUsageLimitError churn).
- **Decoy cloak unconditional** (93837af0): `bash`+`read` injected on every
  request (chat + Responses), `forceStream` on the transport.
- **Force-auto tool choice** for muse models (aa14ef72); stale reasoning
  items stripped on Responses (eafac37d); **union-alpha** added via the
  Messages API (2b65c49f).

### Multi-account free tier (manual connections)
Free/no-auth providers now honor **manual connections**: iterate explicit
connections first (drain — never round-robin), each with its own identity
→ own stable session → own proxy resolution. Virtual "Public" identity
stays as fallback. Add as many OpenCode connections as wanted in the
dashboard; each behaves as a separate account.

### OpenCode Zen (PAYG, `ocz/`) — new provider
Ported from decolua PR #4145 (closed unmerged upstream): apikey provider
on `zen/v1` with dual openai/claude/responses transports, 71 models,
usage (rolling/weekly/monthly), weekly quota window.

# v0.5.75.13 (2026-09-19)

## FreeBuff — tool-map v2.1: rename leg removed

Live matrix against codebuff 0.0.177 (natusa, 2026-09-19) overturned the
v2 assumption that hollow signature tools are log-only:

| wire tools                              | result          |
|-----------------------------------------|-----------------|
| none                                    | 200 OK          |
| genuine `read_files{paths}` only        | 200 OK          |
| genuine + hollow `run_terminal_command` | 200 OK          |
| hollow `read_files{file_path}` alone    | 409 superseded  |
| Hermes 22-tool set (v2 rename active)   | 409 superseded  |

The v1 rename put signature names under client schemas (hollows) AND took
the `read_files` slot, suppressing the genuine companion — genuine=0 on
every tools-carrying request. v2.1: rename leg removed entirely (kept as
`CLIENT_TO_OFFICIAL_DISABLED` reference). Pipeline: drop blacklist names →
pass the rest through → guarantee the genuine `read_files` companion.
Companion is renamed to `__fb_read_files` on every response path even with
no rename mapping, so clients never dispatch on it.

# v0.5.75.12 (2026-09-18)

## FreeBuff — foreign-client gate evasion (tool-map v2)

Codebuff live-enforced foreign-client detection on the free lane
(vendor 0.0.177, 2026-09-17): harness tool NAMES (49-entry blacklist incl.
`delegate_task`/`computer_use`), a genuine-schema check under signature
names, and harness system-prompt markers. Requests carrying third-party
harness tools were downgraded to `inclusionai/ling-3.0-tiny:free` (404
"No endpoints" surfaces). The v1 name-rename map cannot satisfy the new
gate.

- **Drop leg**: every blacklist harness name is removed from the wire
  before send (renaming cannot save them — the signal fires on the name).
- **Companion leg**: one genuine codebuff tool (`read_files`, canonical
  `{paths}` schema, shipped-style description) is injected so
  `foreign_toolset` always clears; renamed to `__fb_read_files` on every
  response path, with a benign stub when called.
- **Rename leg kept**: known harness names still map to codebuff
  equivalents (hollow is log-only upstream); unknown/MCP names pass
  through (observe-only).
- Detector parity asserted in tests via a mirrored classifier over the
  full Hermes 32-tool shape.

Live-verified against codebuff (limited-tier account): the sanitized
request passes the gate — residual 429s are account quota (separate
concern), not foreign-client handling.

# v0.5.75.11 (2026-09-18)

## FreeBuff — reference sync to freebuff-proxy v1.9.0

- **Model catalog grows 5 → 13**: adds DeepSeek V4 Pro, GLM 5.2, Solar Pro 4,
  Muse Spark 1.2/1.3 (Contributor), Claude Fable 5, Ox Alpha, and
  Gemini 3.8 Flash. Display name of `deepseek/deepseek-v4-flash` updated to
  "DeepSeek V4.1 Flash" (id unchanged — display-only rename upstream).
- **Executor agent mapping synced byte-exact with freebuff-proxy v1.9.0**
  (`registry_test.go: expectedFallback`, 18 entries): `openai/gpt-5.6-luna`
  moved from the retired `base2-free-luna` root to `base3-free-luna`
  (upstream `free_mode_legacy_luna_agent` retirement — the old root no longer
  exists, so chats would 404); adds per-model roots for the -max/-es variants
  (`deepseek-v4-pro-max`, `deepseek-v4-flash-max`, `gpt-5.6-luna-max`,
  `gpt-5.6-luna-es`), `muse-spark-1-3`, `ox-alpha`, `solar-pro4`,
  `gemini-3-8-flash`.
- Capabilities: added `ox-alpha` (text-only, reasoning) and `gemini-3.8-flash`
  (vision + reasoning) entries.

Reference: `freebuff-proxy` repo v1.9.0 (2026-09-17); upstream decolua/9router
unchanged since 17c4cc76; OmniRoute freebuff surfaces unchanged in v3.8.50.

# v0.5.75.10 (2026-09-16)

## Fixes
- **Every request in a session was blocked (HTTP 503 "Blocked") when the conversation quoted a curl command.** Render serves each public web service behind Cloudflare's managed web application firewall (WAF), which inspects the request **body** and rejects anything containing a backtick-quoted `curl`/`wget` command with an http(s) URL — it reads the markdown inline-code span as command-injection/SSRF. The block page reads *"Your request was blocked by this site's web application firewall (WAF)"*. That WAF is not configurable (Render's docs: *"There's nothing to configure"*; the request to disable it is an open item in their tracker), and it runs at the edge, so an inbound-IP allowlist does not bypass it either.
  - The blast radius is what made this severe: one quoted curl command anywhere in the context — an `AGENTS.md`, a loaded skill, a tool result — blocks **every subsequent request** in that session, because the text rides along in the conversation history. Editing the source file does not recover the session; by then the pattern is in past messages too. A real session hit this at 265 messages and could not continue at all; 125 files on this machine carry the pattern, including auto-loaded skills.
  - `BaseExecutor` now detects the WAF page and retries **once** with the inline-code marker stripped. Detection requires both the status and the marker text, so a genuine 403 (bad key, quota, region lock) is left alone. Bounded to a single extra attempt.
  - Scope is a **host list**, not a provider or a proxy pool: `frp` is a client-facing alias whose real target is the compatible node's `baseUrl`; the native `freebuff` provider talks to `www.codebuff.com` directly and must not be rewritten; and the shared `vercel-relay` pool is not the cause (the block happens with or without a proxy). Only the opening backtick is removed — the command text, its URL and every other byte are untouched, so a request with no trigger goes out unchanged. Moving the upstream off Render deactivates the guard by deleting one line.
- **Golden URL/header snapshot broke on every version bump**: `tests/translator/golden-url-header.test.js` pinned the literal app version in `X-Msh-Version`. It is the same class of volatile value the file's own `sanitize()` already masks (credentials, kimi device timestamps); now masked as `<VER>` so a release no longer fails it.

## Internal
- Test suite unchanged at **48 failures**, all catalogued in `tests/__baseline__/known-fails.txt`; the regression gate reports *"No regression"*. 13 new cases cover the WAF guard, including a regression for backtick pairing (the first implementation matched whole inline-code spans and was defeated by an earlier unpaired backtick in the prompt).
- DB path, `machineId`, salts and FreeBuff trust are unchanged — no migration and no re-login.

# v0.5.75.9 (2026-09-16)

## Fixes
- **Quota resets were capped at 30 minutes**: when a provider returned its own reset timestamp for a free-tier refusal, `markAccountUnavailable` truncated it to the generic rate-limit ceiling (`MAX_RATE_LIMIT_COOLDOWN_MS`, 30 min) for every provider except Antigravity. A weekly or monthly quota that was empty for days therefore got re-selected every half hour, burning requests against a dead quota and re-triggering the same refusal. Quota-class errors are now bounded by the provider's own quota ceiling (`quotaWindowFor(provider).maxCooldownMs`). Burst rate limits keep the short 30-minute path, and a provider-supplied reset that is genuinely near is still honoured (`Math.min`).
- **Legacy DB migration aborted on every boot**: `importWithAssertion` compared the *absolute* row count of the target table against the number of rows it had just inserted. `seedDefaultCombos` writes its `image`/`translate` rows before the legacy import runs, so that pre-existing pair made every fresh migration look like a dropped-row mismatch — the migration threw `MigrationAborted`, was rolled back, and retried on the next start forever. The assertion now measures a **delta** (`after - before`), so silently-lost rows still fail the guard while seeded rows no longer do.

## Internal
- Test suite stabilised: failures drop from **126 to 48**, and `tests/__baseline__/verify-no-regression.mjs` now reports *"No regression"* instead of flagging everything (the gate could not run correctly on Windows before — it split test names on a `/app/` segment that does not exist here).
- 43 of the remaining failures are the `cursor-agent-proto` codec, whose implementation (`encodeAgentValue` and the rest of the `agent.v1` AgentService codec) **does not exist here or upstream** — the test landed without it. Recorded in `tests/__baseline__/known-fails.txt` as expected-red rather than silently ignored.
- Documentation consolidated into `AGENTS.md` (+ the two nested ones); the stale upstream `CLAUDE.md` was removed. Internal identifiers still say `9router` on purpose (install paths, DB names, salts) — no migration or re-login is required for this release.

# v0.5.75.8 (2026-09-15)

## Features
- **Per-provider quota windows**: a free-tier refusal ("Daily free limit reached", "Weekly quota exceeded", …) now parks the account/model until the provider's **real reset time** instead of retrying it every few minutes on a 429 backoff.
  - Reset is read from the provider's own usage API when available (Kiro `nextDateReset`, Antigravity `bucket.resetTime`, Codex `reset_at`, Grok billing period, CodeBuddy `CycleEndTime`, Kimi/GLM weekly & session windows, GitHub/Zed cycles) with a calendar fallback per cadence (daily / weekly / monthly / 5h session) when the usage API is silent or slow. Probes are cached per connection (5 min, 60 s on failure) and time-bounded, so a burst of failures costs one upstream call.
  - The account stays **active** — it is skipped until the reset and recovers by itself. No manual re-enable, no request storm against a dead quota.
  - All 24 usage providers are classified; a coverage test fails the build if a new provider lands without a cadence.
- **Quota Tracker shows parked providers**: providers without a usage API (Cline, ClinePass, OpenAI-compatible nodes…) used to render an empty card even while the router had parked them. `/api/usage/[connectionId]` now attaches router-side rows (`Quota (daily)`, `Quota (account)`, per-model cooldowns, `Rate limited`) when the provider reports none. Provider-reported data always wins.

## Fixes
- **Cline model catalog**: the picker listed **466** models because the live reader fetched `GET /api/v1/models` — Cline's entire OpenRouter-style proxy catalog (~446 rows, paid, `~`-prefixed aliases). It now reads the account's tiered catalog (`/api/v1/ai/cline/recommended-models`) and takes the `free[]` group, so Cline shows its **5** usable free models. `resolveClinepassModels` was broken the same way (it filtered that catalog for a `cline-pass/` prefix that never appears there, always returning empty) and now returns the `clinePass[]` group (15 models).
- **Cline catalog timeout**: the model-list fetch budget of 5 s aborted the first (cold-start, ~5.7 s) request and silently returned null, dropping the free tier from the picker. Raised to 15 s (warm calls are <500 ms).
- **Grok CLI quota window** was classified monthly; its billing period is `USAGE_PERIOD_TYPE_WEEKLY`, so the account was parked ~5 weeks instead of one.

## Internal
- DB path, `machineId`, salts and FreeBuff trust are unchanged — upgrading requires no re-login or data migration.

# v0.5.75.7 (2026-09-15)

## Features
- **Per-key prepaid token pool**: API keys can now carry a quota plan — model allowlist, total token pool, optional expiry. Limits live in the new `apiKeys.limits` column (`SCHEMA_VERSION` 1 → 2, additive auto-sync; no data migration needed).
  - Pre-dispatch gates (fail-closed): model not in allowlist → `403 model_not_allowed`; pool exhausted → `429 quota_exhausted`; expired → `401 key_expired`.
  - Post-response billing is atomic and **cache-free**: only `(prompt_tokens − cached_tokens) + completion_tokens` is deducted, so cached prompt tokens cost the customer nothing. Works for both streaming and non-streaming paths; billing is fail-open so it can never break a response.
  - Keys without a `limits` blob keep working as unlimited (legacy behaviour).
- **Dashboard plan editor** (Endpoint → API Keys): `Create Key` / `Set plan` opens a pool editor with model search + checklist, token total (with `+1M` / `+5M` / `+25M` / reset quick buttons) and an expiry date. Each key row shows a usage bar (`Pool used / total · N model(s)`), turns red at ≥90% or when expired, and provides one-click `+1M` / `+5M` top-ups.
  - Top-up only raises `totalTokens`; `usedTokens` is preserved, so remaining quota grows exactly by the top-up amount.
  - The model picker merges the static/aliased catalog with custom models and remaps compatible-node ids to their provider prefix (e.g. `frp/…`) — compatible providers were previously invisible in the picker.
- **API**: `POST /api/keys` accepts an optional `limits` object; `PUT /api/keys/[id]` patches `name` and merges partial `limits` edits (`null` clears the plan → unlimited).

## Fixes
- **Error classification**: HTML error pages (Render free-tier cold start, Cloudflare interstitials) are now classified as a short-cooldown transient instead of a 2-minute account lock — the retry succeeds as soon as the origin is awake.
- **Dashboard**: `CompatibleModelsSection` crashed with `ReferenceError: connections is not defined` — the prop is now destructured (and defaults to `[]`).

## Internal
- DB path, `machineId`, salts and FreeBuff trust are unchanged — upgrading requires no re-login or data migration.

# v0.5.75 (2026-09-10)

## Features
- **Video**: add OpenRouter and Vertex AI (Veo) video generation on `/v1/videos/*` via a provider adapter layer; poll requests resolve their provider from `x-connection-id` or `?provider=`
- **Antigravity**: add weekly quota tracking (Gemini weekly / Claude & GPT weekly) and free-tier handling from `retrieveUserQuotaSummary` (#3892)
- **Codex**: add GPT Image 2.5, Flare and Sunburst image models with multi-image support; add the same ids to the OpenAI catalog
- **Qoder**: surface usage to all clients and stop inlining large attachments — images upload through `/api/v2/image/upload` like qodercli, oversized file blocks become stubs, context tier auto-escalates
- **OpenCode Go**: add newly published models (glm-5.3, kimi-k3, deepseek-flash, longcat-2.0, hy4-preview, hy3 on chat/completions; qwen3.8-max, qwen3.8-flash on `/messages`; grok-4.6, gpt-5.6-luna on Responses) and list `deepseek-v4.1-flash` first in the catalog
- **CLI tools**: group the model selector by provider with full-text search and manual custom model ID entry
- **CodeBuddy-CN**: replace `deepseek-v4-flash` with `deepseek-v4.1-flash`

## Fixes
- **Tools**: scope Claude tool type defaulting to gateways declaring `requireClaudeToolType` — the global default broke Anthropic-compatible endpoints that only accept the legacy typeless tool shape (#3905)
- **Claude**: cap re-anchored `cache_control` at the 4-marker budget so a spent budget no longer 400s and triggers a full combo failover; wrap bare single-object content turns before the mid-conversation-system fold
- **Cline / Airforce**: unwrap the `{"success":true,"data":…}` envelope on non-stream chat completions (#3644); add the live Cline/ClinePass model catalog and refresh Airforce free models
- **Cline**: stop `workos:`-prefixing ClinePass API keys (401 on every request, #2333) and add clinepass token refresh
- **Kiro**: never send a top-level `systemPrompt` (`400 REQUEST_BODY_INVALID`); route requests through current runtime surfaces (#3776)
- **Codex**: strip Unicode-property tool schema patterns the validator rejects (#3922); restore the `Version` header and single-source the CLI version
- **DeepSeek**: keep Anthropic-only tool types when forwarding to `/anthropic/v1/messages`
- **Qoder**: drop the Responses usage plumbing from shared translator/handler code, which changed token accounting for every provider, not just Qoder
- **Antigravity**: normalize contents and handle intermediate tool responses; protect the OAuth token-refresh path from Google anti-abuse rate limits (#3813)
- **Providers**: clear stale connection health state (`modelLock_*`, `backoffLevel`, `rateLimitedUntil`, `errorCode`) when a connection is re-validated (#3810, #3830); remove the duplicate `qwen` provider that shadowed `alims-intl`
- **Video / Vertex**: reject job ids and model ids that would escape the request URL path (SSRF)
- **Usage**: parse the Fable weekly limit from `limits[]` instead of fabricating a row (#3847)
- **Auth**: set a 24h `maxAge` on the dashboard session cookie

# v0.5.69 (2026-09-05)

## Features
- **Codex**: add GPT 6.0 Astra (`gpt-6-astra`) with vision, thinking and search capabilities
- **Usage**: add Claude Fable quota tracker support with weekly window normalization (`weekly fable (7d)`)
- **Dashboard**: group Antigravity Gemini and Claude quotas in Quota Tracker, prune stale hidden keys
- **OpenCode Go**: add `muse-spark-1.3-contributor` model and support parallel tool calls on Responses path (#3819)
- **Providers & Models**: align CodeBuddy-CN catalog/capabilities with server config; add GPT-5.6 Sol, Terra, Luna image aliases on Codex (#3806); refresh Qoder catalog with capability mapping and image pass-through
- **CLI tools**: replace Copilot MITM with VS Code extension setup guide
- **Gemini**: persist and replay `thoughtSignature` scoped by session namespace

## Fixes
- **Claude**: normalize adaptive auto effort (`output_config.effort`) (#3792)
- **Antigravity**: prevent Google anti-abuse rate limits during multi-account refresh (#3813)
- **Anthropic-compatible**: forward Claude beta flags to nodes fronting Anthropic (#3797)
- **Dashboard**: dynamic mode label for local/remote detection (#3801)
- **Codex**: format reset credit API errors cleanly (#3778)
- **Security**: guard cowork MCP tools probe against SSRF (#3783)
- **OpenCode Go**: track OpenCode Go quota (#3791) and send stable session headers (#3800)
- **Logger**: suppress noisy background token refresh logs
- **CLI**: export packed `.tgz` directly into workspace root instead of parent directory

# v0.5.65 (2026-09-03)

## Features
- **Fetch**: add Ollama Cloud web fetch provider
- **Gemini / Antigravity**: add Gemini 3.8 Flash support and bump IDE fingerprint to 2.11.0
- **Claude**: add Claude Fable 5.1 support (adaptive thinking with `output_config.effort`), bump Claude Code fingerprint to 2.1.258 for new-model access
- **Providers**: add client-side status filter (All / Active / Inactive / No connection) on the Providers dashboard; add max height and scroll for connection list
- **Providers & Models**: streamline tokenrouter model catalog down to 22 flagship/newest models and add missing provider icons; refresh Codebuddy-CN catalog (add hy4-preview/hy3/glm-5.3/kimi-k3-1, drop EOL glm-5.0/glm-4.7)
- **Models**: capability toggles (vision, reasoning) when adding custom models with upsert and live caps refresh
- **CLI tools**: support saving and managing custom API key presets
- **Quota**: add usage and rate-limit tracking for Groq via `x-ratelimit-*` headers
- **i18n**: complete Indonesian translation (1391 keys)

## Fixes
- **Security**: close SSRF guard bypasses in `ssrfGuard.js` (alternate IPv6 encodings, hostname trailing dots, wildcard DNS resolution check, safe redirect handling) (#3714)
- **Model markers**: strip the `[1m]` context marker Claude Code appends to model names (`claude-opus-5[1m]`) preventing model resolution failures (#3690)
- **Claude**: drop `server_tool_use` blocks carrying foreign IDs to avoid Anthropic 400 rejections; never anchor cache breakpoints on `defer_loading` tools (#3567)
- **Antigravity**: strike-break optimistic quota readings that keep 429ing by blocking the connection+model pair for 15m after 3 strikes (#3681); preserve client identity on model catalog requests (#3414)
- **Auth**: protect root `/responses` rewrite requiring API key validation in dashboardGuard
- **Chat & Docker**: return 503 Service Unavailable when all credentials are rate-limited; explicitly bundle `node-machine-id` into standalone Docker runtime image
- **OpenCode**: route Muse Spark models to `/zen/v1/responses` and declare vision support; filter inactive free model
- **Kiro**: preserve inline images as OpenAI-compatible `image_url` parts in OpenAI MITM; remove redundant top-level `systemPrompt` from payload
- **Usage**: read Responses-shape `cached_tokens` in `extractUsageFromResponse` for non-streaming traffic
- **Models**: support single model lookup with provider-prefixed IDs (e.g. `cc/claude-sonnet-5`)
- **Translator**: route Gemini thinking through `reasoning_effort` on OpenAI-compatible wire; convert `prefixItems` and ensure array items in Gemini schema sanitizer
- **UI**: apply persisted theme before first paint to prevent flash on reload; translate combo vision adapter label

# v0.5.59 (2026-08-29)

## Features
- **Search**: new web search providers — Antigravity (Google Search grounding
  on the existing OAuth account pool, citations keyed and merged by URL) and
  Xquik (X search with `x-api-key` auth, cursor pagination, credit-based
  usage), both on `POST /v1/search`. Based on #3437 by @Nautilaceae
- **Search**: ollama-search and zai-search borrow a chat provider's API key
  instead of requiring their own connection, driven by a new
  `credentialFallback` registry field. zai-search later folded into the `glm`
  provider itself so the web search page shows the shared connection
- **Models**: daily background sync of model capabilities from models.dev —
  modalities keyed by model id (majority of sources must declare one),
  context/output limits keyed by provider + model, strictly additive and
  sitting below the hand-written tables. ETag + mtime cache, 60s startup
  delay, `MODEL_CATALOG_SYNC=off` to disable
- **Models**: add GLM-5.3-Flash (1M context, natively multimodal), DeepSeek
  V4 Vision, Grok 4.5/4.6 (500k context); correct glm-4.6v/4.5v video input
  and output limits, backfill glm-4.6v on glm-cn
- **Usage**: show the Zed plan quota on the dashboard — plan, edit
  predictions, hosted model requests and billing-cycle reset; unlimited rows
  render as "N used · Unlimited"
- **Usage**: track GPT-5.3-Codex-Spark quota windows (spark_session /
  spark_weekly) from the Codex usage response (#3431)
- **Antigravity**: quota-aware routing — on 409/429 fetch live quota for the
  exact per-model resetAt and skip only the exhausted account/model pair;
  report the earliest reset when every account is blocked (#3561)
- **Antigravity**: map image `size` to the aspect-ratio model suffix (-WxH);
  add the Gemini 3.7 Flash tiers to MITM defaultModels so they show up in
  the dashboard model-mapping table
- **Dashboard**: bulk import Grok CLI accounts from JSON — paste an array or
  drag-drop multiple .json files, all OAuth connections created in a single
  call, mirroring the codex flow
- **CLI tools**: endpoint presets shared across every tool card through one
  live-resyncing store, instead of per-card localStorage copies that never
  saw each other's saved endpoints
- **Token Saver**: configurable compression timeout (`headroomTimeoutMs`) —
  the fixed 3000 ms made busy machines time out and send inconsistently
  compressed bodies, hurting prompt caching
- **i18n**: pt-BR expanded to 1132 terms

## Fixes
- **Claude Code**: add Claude Fable 5.1 and advertise Claude Code 2.1.258 in
  both the request header and billing identity; use its permanent adaptive-thinking
  mode with `output_config.effort`
- **Stream**: record usage when a client closes on the terminal event — the
  Responses API has no [DONE] sentinel, so codex closed the socket on
  `response.completed` and cancelled the reader before flush() ran its usage
  side effects; the tail now lives in a once-guarded finalizeStream(). Also
  stop logging a disconnect for every completed Responses call
- **Stream**: parse the trailing NDJSON line an Ollama stream leaves behind
  without a closing newline — the final chunk carrying `done_reason` and the
  token counts was dropped
- **Session**: read the Claude Code session id from the
  `x-claude-code-session-id` header — `metadata.user_id` is dropped by
  Responses translation, splitting one conversation across several
  `prompt_cache_key` values and missing the upstream prefix cache
- **Usage**: preserve nested `cached_tokens` — the top-level-only read
  persisted `cached_tokens: 0` for every Responses-format provider (codex,
  grok-cli, …), billing cache hits at the full input rate
- **Usage**: GLM quotas accept CREDIT_LIMIT plans and multi-interval windows
  (5h session / 7d weekly) instead of overwriting a single "session" key
- **Models**: the catalog sync no longer erases its own output — deltas were
  measured against the previous run's writes (the second run cut `providers`
  from 20 entries to 5); one vote per provider in the modality tally, ETag
  restored from file on startup, and the worker thread dropped after the
  bundler rewrote its path into a module-not-found error
- **Executor**: CommandCode returns errors as a `type:"error"` event inside
  an HTTP 200 NDJSON stream — peek the first events before committing, abort
  and return a real 4xx/5xx so combo/account fallback triggers instead of
  streaming the error text as content
- **Search**: scope failure locks on the credential-fallback path — a failing
  search locked `modelLock___all` and took the shared glm key offline for
  chat as well; locks are now attributed to the connection's owner and
  scoped to `websearch:<provider>`
- **Providers**: connection tests get a 15s AbortSignal timeout instead of
  hanging and exhausting the browser socket pool; guard undefined provider
  names on the providers page
- **Antigravity**: sanitize competing-client branding via a config-driven
  rule table (Zed's Claude-agent prompt, opencode → antigravity) — upstream
  answers 429 Quota Exhausted. Applied in the executor so the shared
  openai-to-gemini translator leaves gemini/vertex/zed untouched
- **MiniMax**: preserve images on the sourceFormat-matched OpenAI transport
  — MiniMax-M3 resolved a Claude-shaped body posted to the OpenAI endpoint,
  silently dropping `image_url` blocks (#3418)
- **Claude**: decloak tool names in same-format streaming passthrough —
  OAuth-cloaked names (CLAUDE_TOOL_SUFFIX) leaked to the client and every
  tool call was rejected as unknown
- **Tools**: default a missing `tools[].type` to "custom" on Claude-format
  requests — strict Anthropic-compatible gateways (MiniMax) reject the
  request with 400 otherwise
- **Translator**: zai thinkingFormat sends the top-level `reasoning_effort`
  object GLM-5.2+ requires — every GLM-5.x request ran at the model default
  (max); gated on GLM-5.2+ since older GLM does not read it (#2721)
- **RTK**: system prompt injection matches each target wire format
  (Chat/Responses/Claude/Gemini/Kiro) and is exact-idempotent across retries,
  so distinct prompts sharing a long prefix are no longer collapsed (#3202).
  Also set the diagnostic before the silent null return on Responses
  translation failure so the panel is no longer blank
- **OpenCode**: route muse-spark through /zen/v1/responses (it 500s on
  chat/completions), normalizing the Chat fields the Responses API rejects
  and clamping max/ultra effort to xhigh
- **CLI**: install better-sqlite3 without build tools on Node 22+ (N-API
  13.0.3 ships per-platform prebuilds, `--ignore-scripts` skips the implicit
  node-gyp build); Node < 22 stays on 12.6.2, working installs untouched
- **CLI tools**: send the API key Codex actually reads —
  `[model_providers.9router.http_headers]` instead of auth.json (which left
  every request 401 and clobbered an existing ChatGPT login); subagent model
  moved to `agents.default_subagent_model`
- **OAuth**: refresh Cline tokens with the extension JSON contract
- **Dashboard**: clamp the API key mask length — keys shorter than 8 chars
  threw RangeError and crashed the media-provider detail page
- **UI**: wait for the Material Symbols font itself before revealing icons —
  `document.fonts.ready` resolved before the 4MB woff2 even started loading,
  leaving icons blank until a second load

# v0.5.55 (2026-08-14)

## Features
- **Auth**: native SAML 2.0 SSO alongside OIDC — AuthnRequest generation, ACS
  assertion handling, SP metadata export, admin config test, replay-protected
  via a `saml_state` cookie matched against `InResponseTo`
- **Providers**: add Alibaba Token Plan (`token-plan.ap-southeast-1`) — the
  fourth Alibaba key type, Singapore-only and OpenAI-compatible transport only
- **Providers**: add `glm-5.3` to GLM Coding and GLM (China)
- **Providers**: Kimchi accepts API keys as well as OAuth (dual auth), with a
  working Test Connection for both modes
- **Antigravity**: add Gemini 3.7 Flash and its tiered high/medium/low variants
  (also in the Gemini registry) with pricing and quota tracking
- **TTS**: add Fish Audio — model id travels in an HTTP `model` header, voice
  is a `reference_id` (preset or cloned voice model)
- **OpenCode-Go**: route by request format via declared transports instead of
  forcing every client into `/messages` — Codex/OpenAI clients no longer pay a
  lossy Responses→OpenAI→Claude double translation. Per-model `supportedFormats`
  guard; the bespoke executor is gone (its shared `_lastModel` cache could cross
  auth headers between concurrent requests)
- **Usage**: dedup + cache Claude quota calls (120s TTL keyed by access token,
  in-flight promise dedup, last-good read on soft failure) to stop multiple
  tabs tripping 429; manual refresh (↻) sends `force=1` to bypass the cache

## Fixes
- **Docker**: ship `sql.js` in the image so the pure-JS DB fallback can start —
  file tracing carried the package's JS without `dist/sql-wasm.wasm`, so a
  container with no native driver aborted with ENOENT and never got a database
  (#3248)
- **Usage**: read Gemini `usageMetadata` out of the antigravity `{ response }`
  envelope — every non-streaming antigravity request logged `IN 0 | OUT 0`
  (#3260)
- **Claude**: re-anchor passthrough cache breakpoints — the client's own
  `cache_control` markers point at pre-normalization offsets, so the tail was
  re-cached every request. Last system block and last tool pinned at 1h TTL,
  last assistant turn at 5m, mid-conversation system messages folded into the
  neighbouring user turn instead of hoisted into `body.system`
- **Combos**: detect images from Hermes and attachment payloads (`images[]`,
  `experimental_attachments`, message-level `image_url`/`audio_url`, inline
  `data:` URIs) so the Vision Adapter auto-switch fires for Hermes/Ollama/
  Vercel AI SDK shapes
- **Kiro**: intercept chat via `x-amz-target` — Kiro IDE 1.0.228+ moved
  `GenerateAssistantResponse` to `POST /` + header, bypassing MITM. Also emit
  the now-mandatory initial-response frame and map the `auto` model slot
- **Kiro**: report real output tokens and stop discarding usable turns
- **Qoder**: detect billing blocks at stream start and return a synthetic 403
  so combo/account fallback triggers instead of leaking the error into chat
- **Antigravity**: strip competitive system prompts (Zed IDE's Claude-agent
  prompt) that Antigravity flags with a 429 Quota Exhausted
- **OpenCode**: send the official client fingerprint on free-tier requests so
  the Console stops classifying traffic as unidentified and rate-limiting it;
  session id resolves conversation-stable to preserve prompt caching
- **Responses**: don't close the message on an empty `tool_calls` array — some
  providers attach one to every chunk, and the truthy check ended the message
  on the first content token (#3234)
- **Translator**: preserve `prompt_cache_key` when converting chat to responses
- **Models**: expose snake_case token limits on `/v1/models`
- **Combos**: strip `stream_options` from the Fusion panel fan-out to avoid a
  DeepSeek 400 (#3024); raise the dashboard model-test probe budget to 1024 and
  soft-pass reasoning-only responses (#3010)
- **Headroom**: the toggle reflects the `headroomEnabled` setting even when the
  proxy is down — it previously showed OFF while the engine kept calling
  `/v1/compress`; proxy status stays visible via the status chip
- **Hermes**: add the `api_key` parameter to the model block in YAML config
- **Providers**: add llm7 to provider test support

## Docs
- **i18n**: add Spanish, French, and Brazilian Portuguese README translations

## Security
- **Real IP**: `x-9r-real-ip` and the Host fallback were trusted from
  client-controlled headers whenever `custom-server.js` was not in the request
  path (`npm run start`, `start:bun`), letting a remote caller pose as local to
  skip API key auth and reach `LOCAL_ONLY_PATHS` (`/api/mcp/*`,
  `/api/tunnel/enable`, `/api/auth/reset-password`). The server now stamps a
  per-process `x-9r-peer-token` on every request it sanitizes and only trusts
  `x-9r-real-ip` behind it — falling back to Host in development and failing
  closed in production (GHSA-pjm4-8fpg-f9p6). Also fixes IPv6 loopback
  detection (`::1`, `::ffff:127.0.0.1`) and routes `npm run start` /
  `start:bun` through `custom-server.js`
- **Search**: `resolveBaseUrl()` rejects client-supplied non-public baseUrls
  (SSRF guard on `/v1/search`)
- **Login**: fresh-install remote login with the default password returns 403
  without issuing a JWT
- **Usage**: `/api/usage/request-details` redacts request/response payloads

# v0.5.50 (2026-08-05)

## Features
- **Providers**: add TokenRouter (300+ models via OpenAI-compatible gateway) with
  exact per-model pricing for 110 models and `reasoning_effort` thinking config
- **Providers**: add Self-hosted STT / TTS / Embedding — point 9Router at your own
  OpenAI-compatible speech and embedding servers (whisper.cpp, faster-whisper,
  Kokoro-FastAPI, llama-server, vLLM, Infinity). Unlike the named cloud providers
  these read `baseUrl` per connection, so one provider can front several machines
- **Combos**: default-enable vision/audio capacity adapter (auto-routes to a
  vision/audio-capable model when the target lacks that capability, falling back
  to `oc/mimo-v2.5-free`), wired into chat handler routing
- **Endpoint**: auto-provision a "Default Key" for first-time users so `/v1`
  works without a manual dashboard step
- **Codex**: support GPT-5.6 Max/Ultra reasoning-level overrides (cx/ routes only)
- **Qoder**: support PAT (Personal Access Token) connections end-to-end, alongside
  OAuth device flow
- **CLI tools**: add OpenDesign (manalkaff/opendesign) support
- **Headroom**: report effective payload savings (tool schema/history bytes broken
  out, byte-savings % reflects actual outbound reduction)
- **Ollama**: Cloud quota tracker (session + weekly) + proactive background OAuth
  token refresh scheduler for all providers

## Fixes
- **Providers**: remove Qwen (OAuth flow stopped working reliably)
- **Passthrough**: detect codex-tui/Codex Desktop as native Codex client — they
  were falling through to the translator and losing fields like `reasoning.summary`
- **OAuth**: scope antigravity header fixes to loadCodeAssist/onboardUser only
- **OAuth**: keep `open` external in the build so xAI/Grok token refresh works on
  Windows
- **OAuth**: declare missing `searchParams` in register-session handler (was a
  500 instead of JSON on error)
- **DB**: `ENABLE_REQUEST_LOGS` env var now overrides the UI setting correctly;
  observability defaults to off (opt-in)
- **Translator**: preserve Codex Responses Lite tool use across chat-native
  OpenAI-compatible providers
- **Translator**: don't drop image-only user messages in `prepareClaudeRequest`
- **Translator**: drop JSON Schema keywords Gemini rejects (`uniqueItems`,
  `contains`, `multipleOf`, `unevaluatedProperties`, `unevaluatedItems`,
  `contentSchema`)
- **Claude**: remove global header cache that leaked one client's identity
  headers onto another client/account sharing the server; gate `anthropic-beta`
  by model instead
- **Antigravity**: drop retired Gemini 3.0 quota tiers, show Gemini 3.6 Flash
  usage bars
- **Cloudflare AI**: declare API key authentication (dashboard showed "No
  connections" despite an active key)
- **GitHub Copilot**: hold monthly-exhausted accounts until UTC month reset
  instead of only cooling down 120s
- **CodeBuddy**: dodge Tencent CN content filter, add usage tracking, normalize
  codebuddy-intl messages
- **Usage**: stop losing cached prompt tokens in the forced-SSE→JSON path
- **Grok CLI**: display the public subscription tier from the OAuth token claim
- **Providers**: count apikey connections for Ollama free-tier card; free-tier/
  apikey providers without `authModes` now default to apikey (were treated
  oauth-only)
- **Build**: include static/public assets in standalone output (login page hung
  on 404s when run via PM2)
- **Server**: support IntelliJ IDEA OpenAI-compatible clients over HTTP (h2c
  upgrade handling)
- **Auth**: redirect already-logged-in sessions away from `/login`
- **CLI tools**: enable Apply button for dynamic OpenAI/Anthropic-compatible
  provider connections
- **CLI**: include complete API artifacts in the CLI package
- **TTS**: a bare self-hosted model name is the MODEL, not the voice — `kokoro`
  was parsed as a voice against a default model, 404ing or synthesising with the
  wrong one
- **Embeddings**: self-hosted embeddings no longer fall back to `api.openai.com`
  when a connection has no `baseUrl` — that silently sent the input text and API
  key to OpenAI under a provider named "Self-hosted"
- **Embeddings**: an adapter that rejects a misconfigured connection now returns
  400 with the reason instead of escaping the handler uncaught
- **Embeddings**: bound the upstream fetch with `FETCH_CONNECT_TIMEOUT_MS` — an
  endpoint that drops packets never returns headers, so the request previously
  hung indefinitely

## Docs
- **i18n**: fix port typo, add RTK Token Saver feature descriptions

# v0.5.45 (2026-07-30)

## Features
- **TTS**: add Xiaomi MiMo text-to-speech (preset voices 冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean, style control, language hint dropdown with Auto-detect, i18n for Style label/placeholder)
- **Providers**: add Poolside (OpenAI-compatible)
- **Providers**: add api-airforce, baidu, bazaarlink, bluesminds, kilo-gateway, llm7, morph, sambanova, tencent
- **OAuth**: zed / trae / windsurf providers + harden callback proxies
- **CLI tools**: set Claude Code max context tokens
- **Qoder**: PAT auth + refresh model list
- **Gemini**: Gemini 3.6 Flash tier routing + Gemini 3.5 Flash Lite
- **Claude**: bump default Opus to `claude-opus-5`
- **Kiro**: add Claude Opus 5 models
- **Usage**: Kimi and DeepSeek usage handlers
- **Usage**: SuperGrok weekly pool via gRPC-web

## Fixes
- **Refresh**: rotate `refresh_token` between retry attempts
- **Kiro**: canonicalize tool history and route API keys correctly
- **Kiro**: normalize dashboard thinking intensity models
- **Cursor**: stop leaking agent tool errors as text
- **Gemini**: fill empty tool schemas after `$ref` strip
- **Antigravity**: strip `stream_options` from non-stream requests
- **Jina-reader**: recover after transient errors, use JSON POST API
- **Usage**: record exact embedding tokens
- **Tunnel**: preserve successor cloudflared PID
- **Console-log**: initialize capture at server boot + prevent SSE proxy buffering
- **Dashboard**: count dual-auth, free-tier OAuth and API-key connections correctly
- **Dashboard**: flex quota rows, thin global scrollbars, no hidden-row overflow

## Docs
- **i18n**: expand pt-BR translation to 986 terms
- README: Indonesian translation

# v0.5.40 (2026-07-20)

## Features
- **i18n**: add Khmer (km) translations
- **CLI tools**: configure Grok Build subagent models
- **Kimi**: merge OAuth into dual-auth provider, add K3 / K2.7 models
- **Dashboard**: ProviderTopology flow animation

## Fixes
- **DB**: resolve better-sqlite3 parameter binding crash
- **Translator**: pass `service_tier` through OpenAI → Responses conversion
- **Kiro**: map GPT-5.6 reasoning effort fields
- **Kiro**: validate terminal streams before emitting output
- **Kiro**: map GPT reasoning effort fields
- **Codex**: current `client_version` + refresh-aware model sync
- **Alicode-intl**: split into Coding Plan + Model Studio providers
- **Cursor**: HTTP/2 AgentService support + version bump 3.12.17
- **Dashboard**: cut duplicate API/icon spam, lazy-load provider assets


# v0.5.35 (2026-07-16)

## Features
- **xAI**: Grok Imagine video generation (`/v1/videos`) + CLI
- **CLI tools**: Grok Build setup — choose separate main/general-purpose/explore/plan models and preserve each model's context window
- **GitHub Copilot**: route Claude models through Copilot's native `/v1/messages`
- **Kiro**: add GPT-5.6 model family (#2596)
- **RTK**: `X-9Router-Token-Saver` header to bypass token savers per request
- **Providers**: quota visibility settings
- **Translator**: drop temperature for all Claude models
- **i18n**: Thai (th) + Persian (fa) translations / README

## Fixes
- **Providers**: bulk-add API keys no longer overwrite existing keys (gap-fill `Key N`)
- **Anthropic**: lowercase `anthropic-version` header to prevent duplication on `/v1/messages`
- **Alicode-intl**: use DashScope compatible-mode endpoint so standard keys work
- **Grok CLI**: align Grok Build with current subscription protocol (#2590)
- **Grok CLI**: surface `expiresAt` so proactive token refresh fires (#2546)
- **Kiro**: improve direct session cache reuse
- **Models**: populate capabilities for live-catalog LLM models
- **Models**: list compatible provider models in `/v1/models`
- **Thinking**: send explicit `thinking:{type:adaptive}` alongside `output_config.effort`
- **Translator**: strip `client_metadata` when converting openai-responses → openai

## Improvements
- **Perf**: skip inactive background services on startup

## Docs
- README: Persian YouTube tutorial

# v0.5.30 (2026-07-10)

## Features
- **Perplexity**: add Agent API provider (#2492)
- **Grok CLI**: add Grok CLI / Grok Build provider with OAuth device-code flow (#2502)
- **Featherless**: add OpenAI-compatible provider presets
- **SearXNG**: configure endpoint via SEARXNG_URL env (#2499)
- **Providers**: add max thinking level for gpt-5.6-sol (#2500)
- **Headroom**: add extras detection and install UI (#2403)
- **Headroom**: activate/uninstall extras + fix interpreter detection
- **PXPipe**: PXPIPE token saver — multimodal prompt compression (#2465)
- **Proxy-Pools**: auto-rotate strategy for no-auth providers (#2409)

## Fixes
- **Cloudflare-AI**: support accountId in bulk key import (#2449)
- **DB**: backup on schema change, MCP child cleanup, codex models, usage providers OOM
- **Codex**: avoid bare-email OAuth dedup (#2477)
- **CLI**: allow staged app bundle builds (#2479)
- **Headroom**: compress Kiro conversation state (#2488)
- **Gemini-CLI**: raise output floor for thinking and add validated toolConfig (#2486)
- **GitHub**: label Copilot profiles by account identity (#2498)
- **OpenAI-to-Claude**: unwrap bare {function:{…}} tools without parent type (#2473)
- **Translator**: clamp thinking effort max->xhigh for OpenAI format (#2466)
- **RTK/find**: detect and group Windows backslash-style find output (#2448)
- **Codex**: handle fast tier and capacity SSE (#2452)
- **Volcengine-ark**: clamp Kimi max_tokens to 32768 endpoint cap
- **Antigravity**: align provider fingerprint with IDE Desktop 2.1.1 (#2389)
- **Pricing**: update Claude/Codex model rates and add new models

## Improvements
- **i18n(zh-CN)**: complete Chinese translations for all UI strings (#2436)
- **API**: caching for tunnel and version status endpoints
- **Perf**: faster dev startup and lighter bundle

# v0.5.20 (2026-07-07)

## Features
- **Thinking**: per-model thinking level picker on provider page — appends `(level)` suffix to copied model names for forced reasoning effort across all formats (openai, claude, gemini, deepseek, kimi, qwen, zai, minimax, hunyuan, step)
- **RTK**: add JS-native git-log filter (#2423)
- **Caveman**: add targeted upstream-aligned style rules (#2424)
- **i18n**: add Farsi (fa) language support (#2385)

## Fixes
- **Thinking**: strip `(level)` suffix from upstream `body.model` so providers no longer reject requests
- **Translator**: preserve developer instructions in openai-responses conversion (#2434)
- **count_tokens**: count structured Anthropic blocks (#2419)
- **Volcengine-ark**: clamp GLM-5 max_tokens to model output ceiling (#2428)
- **Kimi**: normalize reasoning_effort to backend enum (#2427)
- **Claude**: reconcile max_tokens vs thinking budget and lift per-model ceiling (#2381)
- **Kiro**: deliver system prompt natively, add Opus 4.5/4.7/4.8, tolerate dash version ids (#2366)
- **Headroom**: proxy dashboard through app (#2372)
- **MITM**: recover from stale lock file on server start

# v0.5.18 (2026-07-03)

## Features
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) — hodtien
- **Codex**: show reset credit expiry details (#2290) — Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities — decolua
- **ClinePass**: add provider support — sternelee

## Fixes
- **Usage**: dedupe streaming request-details log entries — Qin Li
- **Claude**: drop foreign thinking signatures in passthrough — decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) — KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) — Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) — Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) — MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) — Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens — KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) — Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning — zmf
- **Antigravity**: preserve Claude tool delta index (#2223) — Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) — Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## Features
- Add Kimchi OAuth provider — Nant361
- Refine Qwen vision/video + thinking model patterns — decolua
- Opt-in Codex auto-ping quota keep-alive — Emirhan

## Fixes
- **Responses**: handle response.done terminal events (#2142) — rifuki
- **Headroom**: skip unsafe responses tool history (#2132) — Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) — decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) — warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel — WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) — Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas — iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing — whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) — hamsa0x7
- **Tray**: make Windows context menu DPI-aware — Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker — jellylarper
- **OpenCode**: fix Go GLM — decolua

# v0.5.12 (2026-06-26)

## Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL
