# ATF Airdrop Auto-Miner (Node.js)

Tool tự đăng nhập Telegram và auto-play bot `@ATF_AIRDROP_bot` (mini-app "ATF Miner") bằng cách gọi thẳng game API.

## Kiến trúc

- **`scripts/login.js`** — GramJS đăng nhập bằng số điện thoại, lưu session.
- **`scripts/get-webview.js`** — mở webview của bot, lấy **initData** (auth token, hết hạn ~24h) lưu vào `session/initData.txt`.
- **`lib/game.js`** — game API client: `login`, `start_mine`, `claim`, `get_difficulty`, `get_math_challenge`, `start_task`, `claim_task`.
- **`lib/math.js`** — giải câu hỏi toán học (anti-bot của game) khi bắt đầu mine.
- **`bot.js`** — vòng lặp auto-play: login → (start mine nếu chưa có) → claim định kỳ → chờ ngẫu nhiên.

## Cài đặt

Yêu cầu **Node.js ≥ 16**. Trên Node 16 (chưa có global `fetch`) bot tự dùng fallback HTTP có sẵn (`lib/fetch.js`); trên Node 18+ dùng thẳng global `fetch`. Không cần cài thêm package nào cho HTTP.

```bash
npm install
```

## Bước 1 — API_ID / API_HASH

https://my.telegram.org → **API development tools** → copy `api_id`/`api_hash` vào `.env` (copy từ `.env.example`).

## Bước 2 — Đăng nhập Telegram

```bash
npm run login
```

## Bước 3 — Lấy initData

```bash
npm run webview
```

Lưu initData vào `session/initData.txt`. initData hết hạn ~24h, nhưng `bot.js` sẽ **tự refresh lại** (mỗi 18h hoặc khi gặp lỗi auth) nên bạn không cần chạy lại tay.

## Bước 4 — Auto-play

```bash
npm run start
```

Tùy chỉnh trong `config.js`:
- `MIN_CLAIM_SECONDS` — claim sau bao lâu kể từ lúc bắt đầu chu kỳ (mặc định 6h, tự random ±35%).
- `LOOP_MIN_MS` / `LOOP_MAX_MS` — khoảng chờ ngẫu nhiên giữa các lần kiểm tra.
- `AUTO_REFRESH_INITDATA` — tự refresh initData mỗi `INITDATA_MAX_AGE_SECONDS` (mặc định 1h). Server game hiện từ chối initData cũ bằng `HTTP 401 hash_mismatch` (kiểm tra độ tươi), nên đừng tăng khoảng này quá cao. Gặp `hash_mismatch` bot cũng tự refresh ngay + thử lại.
- `AUTO_TASKS` — thử nghiệm tự làm task (mặc định tắt).
- `HUMAN_LIKE` — tắt/bật lớp hành vi giống người (delay, nhịp ngẫu nhiên).
- `AUTO_BOOST` — tự kích hoạt **Boost** (tương đương "click" tăng speed). Mỗi boost cách nhau ngẫu nhiên 5–8s sau khi server hết cooldown (`BOOST_JITTER_MIN_MS`/`BOOST_JITTER_MAX_MS`), tối đa `MAX_BOOSTS_PER_SESSION` lần/phiên (mặc định 1000 ≈ gần như liên tục), không giới hạn khoảng cách giữa các phiên (`BOOST_SESSION_INTERVAL_MS = 0`). Dừng phiên khi cooldown quá dài (`BOOST_MAX_WAIT_MS`) hoặc khi boost liên tiếp không tăng pending (`BOOST_STALE_LIMIT`). Nếu server trả penalty sẽ tự nghỉ `BOOST_PENALTY_PAUSE_MS`. Khi server báo "Boost is busy right now" (boost đang chạy dở), bot chờ hết boost rồi thử lại tối đa `BOOST_BUSY_RETRY_LIMIT` lần thay vì bỏ cuộc. Lỗi mạng thoáng qua (`fetch failed`) tự thử lại `NETWORK_RETRIES` lần với backoff tăng dần. Giảm các giá trị này nếu muốn chạy an toàn hơn.

## Lưu ý

- Mỗi lần bắt đầu mine game yêu cầu giải 1 câu toán (đã tự động giải).
- Mining là thụ động theo thời gian; claim định kỳ để gom reward và reset cửa sổ 72h.
- **Boost** (`activate_boost`) chính là nút "click" của game: server tự credit tap reward mỗi chu kỳ (`boost_cycle_seconds`, mặc định ~15s). Ở chế độ max-earning, tool bấm ngay khi server hết cooldown (jitter 0.3–1.5s) — nhanh hơn nhiều so với nhịp "giống người" trước đây, nên rủi ro bị flag `status: penalty` cao hơn. Nếu bị penalty, bot tự nghỉ `BOOST_PENALTY_PAUSE_MS`.
- Boost chỉ hoạt động khi đang mining (cần wallet verified).
- Dùng tool có rủi ro bị flag là bot (airdrop cấm automation). Tự chịu trách nhiệm.
