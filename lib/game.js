const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const { sleep, rand } = require('./utils');
const { preRequest } = require('./human');
const fetch = require('./fetch'); // global fetch (Node 18+) hoặc fallback http/https (Node 16)

// Chỉ coi là lỗi mạng thoáng qua (đáng retry) — không retry ReferenceError hay lỗi code
function isNetworkError(e) {
  if (!e) return false;
  if (e instanceof ReferenceError) return false;
  const msg = String(e.message || '');
  if (/fetch failed|network|socket|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ECONNRESET/i.test(msg)) return true;
  if (e.cause && e.cause.code && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ECONNRESET/i.test(String(e.cause.code))) return true;
  return false;
}

const BASE_URL = 'https://atfminers.asloni.online/miner/index.php';
const ORIGIN = 'https://atfminers.asloni.online';
const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

let initData = '';
let initDataMtime = 0;
let tmaSession = '';
let deviceId = '';
let user = null;
let taskCooldowns = {};
let taskStarts = {};
let reactPost = null;

function ensureInitData() {
  if (!fs.existsSync(config.initDataFile)) {
    throw new Error(`initData missing. Run: npm run webview`);
  }
  const mtime = fs.statSync(config.initDataFile).mtimeMs;
  if (!initData || mtime !== initDataMtime) {
    initData = fs.readFileSync(config.initDataFile, 'utf-8').trim();
    initDataMtime = mtime;
  }
  if (!initData) throw new Error('initData is empty. Run: npm run webview');
  return initData;
}

function parseUser() {
  const params = new URLSearchParams(ensureInitData());
  const u = params.get('user');
  return u ? JSON.parse(decodeURIComponent(u)) : null;
}

function getDeviceId() {
  const file = 'session/device_id.txt';
  if (!deviceId) {
    if (fs.existsSync(file)) {
      deviceId = fs.readFileSync(file, 'utf-8').trim();
    } else {
      deviceId = 'dev-' + crypto.randomUUID().replace(/[^A-Za-z0-9._:-]/g, '');
      fs.mkdirSync('session', { recursive: true });
      fs.writeFileSync(file, deviceId);
    }
  }
  return deviceId;
}

function headers() {
  const h = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: ORIGIN,
    Referer: ORIGIN + '/miner/index.html',
    'User-Agent': UA,
  };
  if (ensureInitData()) h['X-Telegram-Init-Data'] = initData;
  if (tmaSession) h['X-ATF-TMA-Session'] = tmaSession;
  return h;
}

function buildBody(extra) {
  return JSON.stringify({
    initData: ensureInitData(),
    request_id: crypto.randomUUID(),
    device_id: getDeviceId(),
    ...extra,
  });
}

// request_id sinh 1 lần cho mỗi lần gọi logic và được tái dùng qua các lần thử lại,
// để server có thể dedupe nếu request đã được xử lý nhưng response bị mất.
async function call(action, payload = {}, { retry = true, _networkRetries = config.NETWORK_RETRIES, _requestId = crypto.randomUUID() } = {}) {
  await preRequest();
  const url = `${BASE_URL}?action=${action}&t=${Date.now()}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: buildBody({ ...payload, request_id: _requestId }),
    });
  } catch (e) {
    // Chỉ retry khi là lỗi mạng thật (fetch failed, mất kết nối...) — không retry ReferenceError/lỗi code
    if (isNetworkError(e) && _networkRetries > 0) {
      const attempt = config.NETWORK_RETRIES - _networkRetries + 1;
      const waitMs = Math.min(10000, rand(1500, 3500) * attempt);
      console.log(
        `[i] Lỗi mạng thoáng qua (${e.message}) — thử lại ${attempt}/${config.NETWORK_RETRIES} sau ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
      return call(action, payload, { retry, _networkRetries: _networkRetries - 1, _requestId });
    }
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  const reason = String((data && data.reason) || '');
  const needsRefresh =
    res.status === 401 || reason.startsWith('tma_session') || reason === 'auth_failed' || reason === 'user_missing';
  if (needsRefresh && retry) {
    await login({ silent: true });
    return call(action, payload, { retry: false, _requestId });
  }
  if (!res.ok || (data && data.status && data.status !== 'success')) {
    const err = new Error(
      `[${action}] HTTP ${res.status}: ${(data && (data.reason || data.message)) || res.statusText}`
    );
    err.data = data;
    throw err;
  }
  return data;
}

async function login({ silent = false } = {}) {
  const u = parseUser();
  if (!u || !u.id) throw new Error('Cannot parse user from initData. Run: npm run webview');
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await call('login', { tg_id: u.id, username: u.username || '' }, { retry: false });
      if (!data || data.status !== 'success' || !data.user) {
        throw new Error(`login failed: ${(data && (data.reason || data.message)) || 'unknown'}`);
      }
      if (data.tma_session_token) tmaSession = String(data.tma_session_token);
      user = data.user;
      if (data.task_cooldowns) taskCooldowns = data.task_cooldowns;
      if (data.task_starts) taskStarts = data.task_starts;
      if (typeof data.react_post !== 'undefined') reactPost = data.react_post;
      await preRequest();
      if (!silent) {
        console.log(
          `[+] Login OK | tg_id: ${u.id} | level: ${user.miner_level || 1} | mined: ${user.mined_balance} ATF`
        );
      }
      return data;
    } catch (e) {
      lastErr = e;
      await sleep(rand(1200, 2500));
    }
  }
  throw lastErr;
}

function getUser() {
  if (!user) throw new Error('Not logged in yet.');
  return user;
}

function setUser(u) {
  user = u;
}

function getTaskState() {
  return { taskCooldowns: { ...taskCooldowns }, taskStarts: { ...taskStarts }, reactPost };
}

async function startTask(taskId, clientStartedAt = Math.floor(Date.now() / 1000)) {
  const u = getUser();
  const data = await call('start_task', {
    tg_id: u.tg_id,
    task_id: taskId,
    client_started_at: clientStartedAt,
  });
  if (data && data.status === 'success') {
    if (typeof data.started_at !== 'undefined') taskStarts[taskId] = parseInt(data.started_at, 10) || clientStartedAt;
    else taskStarts[taskId] = clientStartedAt;
  }
  return data;
}

async function claimTask(taskId, clientStartedAt) {
  const u = getUser();
  const startedAt = clientStartedAt || taskStarts[taskId] || Math.floor(Date.now() / 1000);
  const data = await call('claim_task', {
    tg_id: u.tg_id,
    task_id: taskId,
    client_started_at: startedAt,
  });
  if (data && data.status === 'success') {
    if (typeof data.new_balance !== 'undefined') user = { ...user, mined_balance: data.new_balance };
    if (data.repeatable) {
      if (data.next_available) taskCooldowns[taskId] = parseInt(data.next_available, 10) || 0;
      taskStarts[taskId] = 0;
    } else {
      const done = new Set(user.completed_tasks || []);
      done.add(taskId);
      user = { ...user, completed_tasks: [...done] };
      taskStarts[taskId] = 0;
    }
  }
  return data;
}

// --- Mining math (mirrors frontend) ---

const MAX_CYCLE_SECONDS = 259200; // 72h
const RATE_GROWTH = 1.0181532961;

function clampDifficulty(v) {
  const n = Number(v);
  if (!isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 10000) return 10000;
  return n;
}

function minerRate(level) {
  const lvl = Math.max(1, parseInt(level || 1, 10) || 1);
  return Math.floor(10 * Math.pow(RATE_GROWTH, lvl - 1));
}

function difficultyDivisor(d) {
  const x = clampDifficulty(d);
  if (x <= 100) return 1 + (x - 1) / 100;
  return 1.99 + (x - 100) / 15;
}

function sessionBalanceAt(u, difficulty, nowSec = Date.now() / 1000) {
  if (!u || !u.last_mining_start) {
    return Math.max(0, parseFloat(u && u.pending_reward || 0) || 0);
  }
  const start = parseInt(u.last_mining_start, 10) || 0;
  const cycleStart = parseInt(u.mining_cycle_started_at || 0, 10) || start;
  const freezeAt = parseInt(u.mining_freezes_at || 0, 10) || (cycleStart + MAX_CYCLE_SECONDS);
  const cappedNow = freezeAt > 0 ? Math.min(nowSec, freezeAt) : nowSec;
  const elapsed = Math.max(0, cappedNow - start);
  const pending = parseFloat(u.pending_reward || 0) || 0;
  const rate = minerRate(u.miner_level);
  const divisor = difficultyDivisor(difficulty);
  const passiveReward = (elapsed * (rate / divisor)) / 86400;
  return Math.max(0, Number((pending + passiveReward).toFixed(4)));
}

async function activateBoost(u, difficulty) {
  const nowSec = Math.floor(Date.now() / 1000);
  const displayPreview = sessionBalanceAt(u, difficulty, nowSec);
  let data;
  try {
    data = await call(
      'activate_boost',
      { tg_id: u.tg_id, display_preview: displayPreview },
      { retry: false }
    );
  } catch (e) {
    const reason = String((e.data && (e.data.reason || e.data.message)) || e.message || '');
    if ((e.data && e.data.status === 'penalty') || /penalty/i.test(reason)) {
      return { status: 'penalty', reason };
    }
    if (/busy/i.test(reason)) {
      // Trả kèm payload của response để autoBoost dùng timestamps mới nhất từ server nếu có
      return { status: 'busy', reason, data: e.data || null };
    }
    throw e;
  }
  if (data && data.status === 'success') {
    const patch = {
      boost_ready_at: data.boost_ready_at,
      boost_active_until: data.boost_active_until,
      pending_reward: data.pending_reward,
      boost_power_snapshot: data.boost_power_snapshot,
      mining_difficulty_snapshot: data.mining_difficulty_snapshot,
      mining_cycle_started_at: data.mining_cycle_started_at,
      mining_freezes_at: data.mining_freezes_at,
      boost_cycle_seconds: data.boost_cycle_seconds,
      boost_taps_per_sec: data.boost_taps_per_sec,
    };
    const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v !== 'undefined'));
    user = { ...user, ...cleaned };
    if (data.user) user = { ...user, ...data.user };
  }
  return data;
}

module.exports = {
  call,
  login,
  getUser,
  setUser,
  getTaskState,
  startTask,
  claimTask,
  parseUser,
  getDeviceId,
  activateBoost,
  sessionBalanceAt,
  minerRate,
  difficultyDivisor,
};
