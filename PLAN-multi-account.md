# Plan: Chạy nhiều Account trên 1 Node Process với Proxy WebShare

> Trạng thái: **ĐỀ XUẤT** — chưa code. Review xong mới triển khai.
> Quyết định kiến trúc: **1 Node process chạy N account** (đã chốt theo yêu cầu), config bằng `proxy.txt` + `account.txt`, session riêng từng account.

## 1. Đánh giá hiện trạng (tại sao chỉ chạy được 1 account)

Toàn bộ code hiện tại thiết kế cho **đúng 1 account**:

| File | Vấn đề |
|---|---|
| `config.js` | Đọc 1 bộ `API_ID/API_HASH/PHONE/SESSION_FILE/initDataFile` từ `.env` |
| `lib/game.js` | State dạng **singleton module-level**: `initData`, `tmaSession`, `deviceId`, `user`, `taskCooldowns`... — 2 account trong 1 process sẽ ghi đè lẫn nhau |
| `lib/client.js` | `deviceModel` hardcode `'Samsung SM-A515F'` cho mọi account (fingerprint giống hệt = red flag) |
| `lib/game.js:51` | `getDeviceId()` hardcode đường dẫn `session/device_id.txt` |
| `bot.js` | 1 vòng lặp duy nhất + `process.exit(1)` khi fatal (sẽ giết cả process khi chạy nhiều account) |
| `lib/fetch.js` + `lib/game.js` | HTTP API **không có proxy** |
| `lib/client.js` | MTProto (Telegram) **không có proxy** |

**Kết luận:** Chạy N account trong 1 process **được**, nhưng bắt buộc refactor phần singleton → factory và tách state theo từng account (mục 4, 5).

## 2. Đánh giá Proxy free WebShare

Theo dashboard + thông số công khai của WebShare (free plan):

| Thông số | Giá trị | Ảnh hưởng |
|---|---|---|
| Số proxy | **10** (datacenter, shared) | Giới hạn cứng số account đặt proxy riêng |
| Bandwidth | **1 GB/tháng** | Nút thắt lớn nhất — hết là proxy ngừng hoạt động tới tháng sau |
| Concurrent threads | 100 | Đủ dư |
| Protocol | HTTP, HTTPS, **SOCKS5** | SOCKS5 dùng được cho cả Telegram lẫn game API |
| Auth | username/password hoặc IP whitelist | Username/password đơn giản nhất |
| Loại IP | Datacenter, chủ yếu US, **shared** giữa nhiều khách | Dễ bị Telegram/game đánh giá thấp, dễ bị flag |
| Reliability | ~93-94% success, latency ~1.1s | Cần retry mạnh (bot đã có `NETWORK_RETRIES`) |

### Ước lượng bandwidth (quan trọng)
- Mỗi request game API (login, boost, task, claim) ~1–3 KB.
- Boost là nguồn request chính: 300 boost/phiên × ~2 KB ≈ **600 KB/phiên**.
- 10 account × 1–2 phiên boost/ngày ≈ **6–12 MB/ngày** → ~180–360 MB/tháng. **Vừa đủ trong 1 GB** nhưng phải giảm `MAX_BOOSTS_PER_SESSION` và theo dõi dashboard.
- Chưa tính MTProto (Telegram sync, webview refresh). Nên **giảm boost** khi chạy nhiều account.
- **Vì proxy cả 2 đường nên lượng này đều tính vào 1GB/tháng** — MTProto sync + mỗi lần refresh initData (~webview request) cộng thêm. Ước lượng an toàn: chạy 5–7 account + giảm boost, dùng ~300–500 MB/tháng, còn dư cho phát sinh.

### Vấn đề đáng lưu ý
1. **Telegram ban rất nhạy với datacenter proxy** khi đăng nhập account mới. Rủi ro cao nhất của plan này, nhất là với account mới tạo.
2. IP datacenter **shared** → nếu account khác cũng dùng webshare free (cùng IP), có thể dính "dirty IP" đã bị game/Telegram chặn.
3. 10 proxy = **tối đa 10 account** nếu muốn mỗi account 1 IP riêng. Đề xuất chạy **5–7** để dự phòng proxy chết/đổi.
4. Free proxy có thể chậm/lỗi → phải tăng retry, backoff.
5. WebShare hỗ trợ **cùng host:port cho cả HTTP (CONNECT) lẫn SOCKS5** (tự phát hiện protocol) → 1 dòng trong `proxy.txt` dùng được cho **cả Telegram lẫn game API**.
6. Dashboard có `removeType=refresh_all` → danh sách proxy có thể bị **refresh/đổi IP hàng tháng**; đổi IP giữa chừng sẽ phá sticky session (phải re-login/re-auth).

## 3. Rủi ro tổng thể (theo khuyến nghị: proxy CẢ Telegram + game API, cùng 1 proxy sticky/account)

### Trước (chỉ proxy game API)
- [HIGH] **Fingerprint mismatch**: initData sinh qua MTProto từ IP thật, game API đi ra từ IP datacenter → dấu hiệu bất thường rõ ràng.
- [HIGH] IP thật vẫn lộ cho Telegram; nhiều account chung 1 IP thật → rủi ro Telegram ban không giảm.
- [MEDIUM] Nhiều account cùng IP datacenter WebShare shared → dính chung "dirty IP".

### Sau (proxy cả 2 đường, sticky)
- [CRITICAL] **Telegram khóa account khi login/hoạt động qua IP datacenter** — nay login MTProto cũng qua WebShare (SOCKS5) nên rủi ro này **tăng**, đặc biệt account mới. Không có cách nào giảm hoàn toàn với proxy free.
- [HIGH] **Proxy chết giữa chừng** → mất cả 2 đường cùng lúc: MTProto reconnect + game API lỗi; nếu sticky bị phá (đổi IP) → phải re-login + refresh initData.
- [HIGH] **Refresh proxy hàng tháng** (`refresh_all`) đổi IP → tất cả account cần cập nhật proxy trong `proxy.txt` + re-auth.
- [MEDIUM] **Hết 1GB bandwidth** → cả hệ thống ngừng giữa tháng. Giờ bandwidth gồm cả MTProto (sync + webview refresh), không chỉ game API.
- [MEDIUM] Game flag theo **fingerprint thiết bị chung** (đã xử lý: fingerprint per-account theo seed) hoặc theo dải IP datacenter shared.
- [MEDIUM] Penalty (`status: penalty`) khi auto boost quá nhanh — đã có cơ chế tự nghỉ trong bot.
- [LOW] Số account > 10 → phải reuse proxy (nhiều account chung IP) — tự phá mục đích tách IP.

## 4. Kiến trúc — 1 Node process, N account

```
D:\Tool tele\atf\
├─ proxy.txt            # mỗi dòng 1 proxy:  host:port:username:password   (SOCKS5)
├─ account.txt          # mỗi dòng 1 account:  name,phone,apiId,apiHash
├─ main.js              # ENTRY MỚI — đọc 2 file trên, chạy N loop trong 1 process
├─ bot.js               # refactor: export runAccount(cfg); vẫn chạy 1 account khi chạy tay
├─ config.js            # giữ làm config mặc định (env) — mỗi account override
├─ lib/game.js          # REFACTOR: singleton → createGameClient(accountCfg)
├─ lib/client.js        # REFACTOR: createClient(accountCfg) — session + proxy + fingerprint riêng
├─ lib/webview.js       # REFACTOR: refreshInitData(accountCfg) — ghi file riêng từng account
├─ lib/fetch.js         # thêm hỗ trợ options.agent để gắn HttpsProxyAgent
├─ scripts/login-all.js # MỚI: login tuần tự từng account trong account.txt (nhập code thủ công)
├─ scripts/webview-all.js # MỚI: lấy initData cho từng account
└─ session/
   ├─ <name>/session.txt      # StringSession của account <name>
   ├─ <name>/initData.txt
   ├─ <name>/device_id.txt
   └─ <name>/webview.txt
```

### Định dạng file cấu hình

**`proxy.txt`** — lấy từ WebShare dashboard (mục Proxy list → copy), 1 dòng 1 proxy:
```
# host:port:username:password
p1.webshare.io:1080:abc123user:xyzpass
p2.webshare.io:1080:abc123user:xyzpass
...
```
> 1 dòng dùng cho **cả 2 đường**: WebShare cùng host:port tự nhận diện HTTP (cho game API) lẫn SOCKS5 (cho Telegram). Chỉ cần lấy port SOCKS5 (thường 1080) làm chuẩn trong file.

**`account.txt`** — 1 dòng 1 account, `name` dùng làm tên folder session + tiền tố log:
```
# name,phone,apiId,apiHash
acc1,+84901234567,1234567,a1b2c3d4...
acc2,+84909876543,1234567,a1b2c3d4...
```

> Lưu ý: cùng 1 bộ `apiId/apiHash` có thể đăng nhập nhiều số điện thoại (đây là app credentials, không gắn với user). Viết riêng theo từng dòng để linh hoạt.

### Gán proxy cho account
- Account thứ i dùng proxy thứ `i % sốProxy` (tuần tự, vòng tròn).
- **Sticky:** mỗi account giữ cố định 1 proxy (không đổi IP giữa chừng) — đổi IP đột ngột khi đang session dễ bị flag.
- **1 proxy = cả 2 đường cho account đó:**
  - Telegram MTProto → SOCKS5: `{ ip, port, socksType: 5, username, password }`.
  - Game API → HTTP CONNECT qua `HttpsProxyAgent` với URL dạng `http://user:pass@host:port`.
  - Nhờ vậy initData sinh từ cùng IP nơi game API request đi ra → **hết fingerprint mismatch**.
- Số account > số proxy → cảnh báo (nhiều account chung IP, tăng rủi ro).
- Không có proxy trong file → chạy thẳng (giữ nguyên hành vi hiện tại).
- Khi WebShare refresh danh sách proxy (`refresh_all`): cập nhật lại `proxy.txt`, và các account bị đổi IP cần re-login + refresh initData.

## 5. Thay đổi chi tiết

### 5.1 `lib/game.js` — singleton → factory (refactor lõi)
- Đổi từ state module-level sang **closure per instance**:
  ```js
  function createGameClient(acc) {
    // mỗi instance giữ riêng: initData, tmaSession, deviceId, user,
    // taskCooldowns, taskStarts, reactPost
    return { call, login, getUser, setUser, getTaskState, startTask, claimTask, activateBoost, sessionBalanceAt, ... };
  }
  ```
- `ensureInitData()` đọc từ `acc.initDataFile`; `getDeviceId()` đọc/ghi `acc.deviceIdFile`.
- HTTP fetch: nếu `acc.proxy` có → dùng **`HttpsProxyAgent`** (`https-proxy-agent`, HTTP CONNECT) gắn vào `https.request` của `fetchFallback` (`lib/fetch.js` thêm hỗ trợ `options.agent`); không có proxy → giữ global `fetch`/fallback cũ.
- `BASE_URL/ORIGIN/UA` giữ nguyên ở module (dùng chung).

### 5.2 `lib/client.js` — per-account client
- `createClient(acc)`:
  - Nạp StringSession từ `acc.sessionFile` (mỗi account 1 file riêng).
  - Có proxy → truyền `{ proxy: { ip, port, socksType: 5, username, password } }` vào `TelegramClient` (GramJS hỗ trợ SOCKS5 sẵn qua pkg `socks` đã có trong `node_modules`). **Không hỗ trợ HTTP proxy cho MTProto** — chỉ SOCKS5/MTProxy.
  - Fingerprint theo account: `deviceModel/systemVersion/appVersion` sinh từ seed cố định theo `acc.name` (ổn định giữa các lần restart, khác nhau giữa các account).

### 5.3 `lib/webview.js` — per-account
- `refreshInitData({ acc })`: dùng `createClient(acc)` (có proxy), ghi `acc.initDataFile` + `acc.webviewFile`. Bỏ hardcode `session/webview.txt`.

### 5.4 `bot.js` — export vòng lặp theo account
- Tách thành `runAccount(acc)`:
  - `const game = createGameClient(acc)`; `runCycle(game, acc)` giữ nguyên toàn bộ logic claim/boost/task hiện có.
  - Tiền tố log `[acc.name]` cho mọi dòng output.
  - Bỏ `process.exit(1)` ở chỗ fatal → throw để `main.js` bắt riêng cho account đó, không giết các account khác.
- **Backward-compat:** `node bot.js` (không có main.js) vẫn chạy 1 account như cũ với config `.env`.

### 5.5 `main.js` — chạy N account
- Đọc `proxy.txt` + `account.txt` → build mảng accountCfg.
- `Promise.all`/loop các `runAccount(acc)` (mỗi account 1 `TelegramClient` + 1 vòng lặp riêng).
- Cô lập lỗi: account nào fatal thì log + thôi account đó, các account khác chạy tiếp.
- Prefix log theo account; in 1 dòng tổng kết khi start: danh sách account + proxy tương ứng.

### 5.6 Login thủ công theo account (đúng yêu cầu)
- `scripts/login-all.js`: đọc `account.txt`, **tuần tự từng account** → `client.start()` hỏi mã OTP nhập tay → lưu session vào `session/<name>/session.txt`. **Số lần nhập code = số dòng trong account.txt**.
- Có thể chạy riêng từng account: `node scripts/login-all.js --name acc1` (chỉ login 1 account).
- Sau khi login xong: `scripts/webview-all.js` lấy initData cho từng account (hoặc để `bot.js` tự refresh như hiện tại).

### 5.7 Config boost theo số account
- Khi chạy N account, giảm `MAX_BOOSTS_PER_SESSION` và tăng `BOOST_SESSION_INTERVAL_MS` để: (a) đỡ tốn bandwidth, (b) đỡ nhìn "robot" trên server game.

## 6. Luồng setup 1 account mới

1. Thêm 1 dòng vào `account.txt`: `name,phone,apiId,apiHash`.
2. (Nếu cần proxy riêng) đảm bảo `proxy.txt` có đủ proxy.
3. `npm run login-all` → nhập code Telegram cho account đó (thủ công, như yêu cầu).
4. `npm run start` (chạy `main.js`) → account tự refresh initData khi cần.
5. Kiểm tra log theo prefix `[name]` + dashboard WebShare (bandwidth, IP).

## 7. Các bước triển khai (phases)

| Phase | Nội dung | Ước lượng |
|---|---|---|
| 0 | Review plan, chốt format `proxy.txt`/`account.txt` | – |
| 1 | Refactor `lib/game.js` → factory `createGameClient(acc)` | nửa ngày |
| 2 | Refactor `lib/client.js` + `lib/webview.js` per-account (SOCKS5 + fingerprint) | nửa ngày |
| 3 | Refactor `bot.js` → `runAccount(acc)` + proxy cho game API (`https-proxy-agent`) | nửa ngày |
| 4 | `main.js` + `scripts/login-all.js` + `scripts/webview-all.js` | vài giờ |
| 5 | Test: 1 account qua proxy (so sánh hành vi với trước khi refactor) | nửa ngày |
| 6 | Test N account: 3 → 5 → 7, theo dõi bandwidth + độ ổn định | 1–2 ngày |
| 7 | Tinh chỉnh boost/throttle, log, restart thủ công | liên tục |

## 8. Kết luận / Quyết định cần chốt

- **Chạy 1 Node process nhiều account: CÓ**, khả thi với refactor ở mục 5. Điểm mấu chốt là `lib/game.js` phải bỏ singleton (state per-account) và `bot.js` không được `process.exit(1)`.
- **Đã chốt: proxy cả Telegram (SOCKS5) lẫn game API (HTTP CONNECT)** bằng cùng 1 proxy sticky/account — bỏ fingerprint mismatch, nhất quán IP cho từng account.
- **Login thủ công N lần = số dòng account.txt** — đúng như bạn muốn, script login tuần tự hỏi code từng account.
- **Rủi ro còn lại (không loại được với proxy free):** Telegram ban khi login qua IP datacenter, proxy chết/đổi IP giữa chừng, và bandwidth 1GB/tháng (giờ gồm cả MTProto). Đây là rủi ro vòng đời account, không phải rủi ro code.
- **Nên bắt đầu với 3–5 account** để đo độ ổn định + bandwidth trước khi lên 7–10.
- **Chưa quyết định:** số account tối đa? Có giảm boost khi nhiều account không?
