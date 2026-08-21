const game = require('./lib/game');
const { solveMathQuestion } = require('./lib/math');
const { humanDelay, sleep, rand } = require('./lib/utils');
const human = require('./lib/human');
const config = require('./config');
const fs = require('fs');
const { refreshInitData } = require('./lib/webview');

async function ensureFreshInitData() {
  if (!config.AUTO_REFRESH_INITDATA) return;
  const file = config.initDataFile;
  const age = fs.existsSync(file) ? (Date.now() / 1000 - fs.statSync(file).mtimeMs / 1000) : Infinity;
  if (age < config.INITDATA_MAX_AGE_SECONDS) return;
  console.log(`[~] initData cũ (${Math.round(age / 3600)}h) — đang refresh qua Telegram...`);
  await refreshInitData();
  console.log('[+] initData refreshed');
}

function claimPreview(user, difficulty) {
  return game.sessionBalanceAt(user, difficulty, Date.now() / 1000);
}

async function fetchDifficulty(tgId) {
  try {
    const data = await game.call('get_difficulty', { tg_id: tgId });
    return data.difficulty ?? 1;
  } catch (e) {
    console.log('[i] get_difficulty:', e.message);
    return 1;
  }
}

async function startMining(user) {
  console.log('[+] No active mining session. Solving math challenge...');
  const challenge = await game.call('get_math_challenge', { tg_id: user.tg_id, scope: 'start_mine' });
  if (!challenge.challenge_id || !challenge.question) {
    throw new Error('get_math_challenge: missing challenge data');
  }
  console.log('[+] Math question:', challenge.question);
  await humanDelay(1800, 4500); // giống người gõ đáp án
  const answer = solveMathQuestion(challenge.question);
  console.log('[+] Answer:', answer);
  await humanDelay(300, 900);
  const res = await game.call('start_mine', {
    tg_id: user.tg_id,
    math_challenge_id: challenge.challenge_id,
    math_answer: answer,
  });
  console.log('[+] Mining started at', res.start_time);
  return res;
}

async function claimMining(user, difficulty) {
  const preview = claimPreview(user, difficulty);
  console.log('[+] Claiming ~', preview, 'ATF ...');
  const res = await game.call('claim', { tg_id: user.tg_id, claim_preview: preview });
  if (res.claimed_amount) console.log('[+] Claimed', res.claimed_amount, 'ATF');
  if (res.user) game.setUser({ ...user, ...res.user });
  return res;
}

let lastBoostAt = 0;

async function autoBoost(user, difficulty, deadlineSec = 0) {
  if (!config.AUTO_BOOST) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceLast = nowSec - Math.floor(lastBoostAt / 1000);
  if (sinceLast < config.BOOST_SESSION_INTERVAL_MS / 1000) {
    console.log(`[i] Boost session trong ${Math.round((config.BOOST_SESSION_INTERVAL_MS / 1000 - sinceLast) / 60)} phút nữa`);
    return;
  }
  const readyAt = parseInt(user.boost_ready_at || 0, 10) || 0;
  if (readyAt > nowSec) return; // server cooldown

  // --- Giới hạn phiên boost theo cửa sổ thời gian còn lại trước task kế tiếp ---
  // deadlineSec = thời điểm task kế tiếp trong TASK_LIST có thể bắt đầu (unix seconds)
  const boostCycleSec = Math.max(5, parseFloat(user.boost_cycle_seconds || 0) || 30);
  const avgJitterSec = (config.BOOST_JITTER_MIN_MS + config.BOOST_JITTER_MAX_MS) / 2000;
  const perBoostSec = boostCycleSec + avgJitterSec;
  let boostUntilSec = 0;
  let maxBoosts = config.MAX_BOOSTS_PER_SESSION + rand(0, 2);
  if (deadlineSec > 0) {
    if (deadlineSec <= nowSec) {
      console.log('[i] Boost: task kế tiếp đã sẵn sàng — ưu tiên làm task, bỏ qua boost.');
      return;
    }
    boostUntilSec = deadlineSec - config.BOOST_TASK_MARGIN_SECONDS;
    const windowSec = Math.max(0, boostUntilSec - nowSec);
    const fits = Math.max(0, Math.floor(windowSec / perBoostSec));
    if (fits < maxBoosts) {
      maxBoosts = fits;
      console.log(
        `[i] Boost: cửa sổ ~${Math.round(windowSec / 60)} phút trước task kế tiếp → tối đa ${fits} lần boost`
      );
    }
  }
  if (maxBoosts <= 0) {
    console.log('[i] Boost: không còn đủ thời gian trước task kế tiếp, bỏ qua phiên.');
    return;
  }
  let boosts = 0;
  let busyRetries = 0;
  let lastPending = parseFloat(user.pending_reward || 0) || 0;
  let staleCount = 0;
  let adaptiveBufferMs = config.BOOST_SAFETY_BUFFER_MS;
  console.log(`[~] Boost session (tối đa ${maxBoosts} lần)...`);
  while (boosts < maxBoosts) {
    // Đến gần giờ làm task kế tiếp thì dừng boost để không lỡ task
    if (boostUntilSec > 0 && Math.floor(Date.now() / 1000) >= boostUntilSec) {
      console.log('[i] Boost: sắp đến giờ task kế tiếp — dừng phiên.');
      break;
    }
    let res;
    try {
      await human.think(1200, 3500);
      res = await game.activateBoost(user, difficulty);
    } catch (e) {
      // Lỗi mạng/API sau khi đã thử lại — dừng phiên sạch, không làm chết cả cycle
      console.log('[-] Boost: lỗi mạng/API — dừng phiên (thử lại vòng sau).', e.message);
      break;
    }
    user = game.getUser();

    if (res && res.status === 'busy') {
      busyRetries++;
      if (busyRetries >= config.BOOST_BUSY_RETRY_LIMIT) {
        console.log(`[-] Boost: server liên tục báo "busy" (${busyRetries}/${config.BOOST_BUSY_RETRY_LIMIT}) — dừng phiên.`);
        break;
      }
      // Tăng buffer mỗi lần busy (adaptive backoff)
      adaptiveBufferMs = Math.min(config.BOOST_BUFFER_MAX_MS, adaptiveBufferMs + config.BOOST_BUFFER_GROW_MS);
      const busyData = (res && res.data) || {};
      const nowSecBusy = Math.floor(Date.now() / 1000);
      const activeUntil =
        parseInt(busyData.boost_active_until || user.boost_active_until || 0, 10) || 0;
      const readyUntil = parseInt(busyData.boost_ready_at || user.boost_ready_at || 0, 10) || 0;
      const resumeAt = Math.max(activeUntil, readyUntil);
      let waitMs = 0;
      if (resumeAt > nowSecBusy) {
        waitMs = (resumeAt - nowSecBusy) * 1000 + adaptiveBufferMs + rand(config.BOOST_JITTER_MIN_MS, config.BOOST_JITTER_MAX_MS);
      } else {
        waitMs = boostCycleSec * 1000 + adaptiveBufferMs + rand(config.BOOST_JITTER_MIN_MS, config.BOOST_JITTER_MAX_MS);
      }
      if (waitMs > config.BOOST_MAX_WAIT_MS) {
        console.log('[i] Boost: cooldown quá dài — dừng phiên, chờ lần sau.');
        break;
      }
      console.log(
        `[~] Boost đang bận (busy) — chờ ~${Math.round(waitMs / 1000)}s (buffer: ${Math.round(adaptiveBufferMs / 1000)}s) rồi thử lại (${busyRetries}/${config.BOOST_BUSY_RETRY_LIMIT})`
      );
      await sleep(waitMs);
      continue;
    }
    if (res && res.status === 'penalty') {
      console.log('[-] Boost penalty:', res.reason);
      console.log(`[~] Nghỉ ${Math.round(config.BOOST_PENALTY_PAUSE_MS / 60000)} phút trước khi thử lại`);
      lastBoostAt = Date.now() + config.BOOST_PENALTY_PAUSE_MS;
      await sleep(config.BOOST_PENALTY_PAUSE_MS);
      return;
    }
    if (!res || res.status !== 'success') {
      console.log('[-] Boost không thành công:', res && (res.reason || res.message));
      return;
    }
    boosts++;
    busyRetries = 0;
    // Giảm buffer dần khi boost thành công (trả về baseline)
    adaptiveBufferMs = Math.max(config.BOOST_SAFETY_BUFFER_MS, adaptiveBufferMs - config.BOOST_BUFFER_SHRINK_MS);

    const newPending = parseFloat(user.pending_reward || 0) || 0;
    if (newPending > lastPending + 0.0001) {
      staleCount = 0;
    } else {
      staleCount++;
    }
    lastPending = newPending;

    const cycleSec = parseFloat(user.boost_cycle_seconds || 0) || 0;
    console.log(
      `[+] Boost #${boosts}/${maxBoosts} OK | pending: ${newPending} | cycle: ${cycleSec}s | ready_at: ${user.boost_ready_at || 0}`
    );

    if (staleCount >= 2) {
      console.log('[-] Cảnh báo: pending_reward không tăng sau 2 boost — boost có thể không được credit.');
    }
    if (staleCount >= config.BOOST_STALE_LIMIT) {
      console.log(`[-] ${config.BOOST_STALE_LIMIT} boost liên tiếp không tăng pending — dừng phiên để tránh spam vô ích.`);
      break;
    }

    // Chờ hết cooldown server (boost cycle) + jitter — dùng adaptive buffer
    const nextReady = parseInt(user.boost_ready_at || 0, 10) || 0;
    let waitMs = 0;
    if (nextReady > 0) waitMs = (nextReady - Date.now() / 1000) * 1000 + adaptiveBufferMs + rand(config.BOOST_JITTER_MIN_MS, config.BOOST_JITTER_MAX_MS);
    if (waitMs > 0) {
      if (waitMs > config.BOOST_MAX_WAIT_MS) {
        // cooldown quá dài — dừng phiên, chờ lần sau
        await humanDelay(3000, 6000);
        break;
      }
      await sleep(waitMs);
    } else {
      await humanDelay(8000, 15000);
    }
  }
  lastBoostAt = Date.now();
  console.log('[~] Hết phiên boost.');
}

const TASK_LIST = [
  { id: 'youtube_like_comment', minSeconds: 30 },
  { id: 'twitter_retweet', minSeconds: 30 },
  { id: 'website_visit', minSeconds: 0 },
  { id: 'telegram_react_latest', minSeconds: 20 },
];

// Thời điểm (unix seconds) task sớm nhất trong TASK_LIST có thể bắt đầu:
// - có task sẵn sàng ngay → trả về nowSec
// - tất cả đang cooldown → trả về thời điểm hết cooldown sớm nhất
// - chưa có dữ liệu cooldown → trả về Infinity (không giới hạn)
function nextTaskAvailableSec() {
  const state = game.getTaskState();
  const nowSec = Math.floor(Date.now() / 1000);
  let next = Infinity;
  let hasCooldown = false;
  for (const t of TASK_LIST) {
    const cd = state.taskCooldowns && state.taskCooldowns[t.id];
    const nextAvail = cd ? parseInt(cd, 10) || 0 : 0;
    if (nextAvail <= nowSec) return nowSec; // task sẵn sàng ngay bây giờ
    if (nextAvail > 0) {
      hasCooldown = true;
      next = Math.min(next, nextAvail);
    }
  }
  return hasCooldown ? next : Infinity;
}

async function autoTasks() {
  const state = game.getTaskState();
  const nowSec = Math.floor(Date.now() / 1000);
  const ready = [];
  for (const t of TASK_LIST) {
    const cd = state.taskCooldowns && state.taskCooldowns[t.id];
    const nextAvail = cd ? parseInt(cd, 10) || 0 : 0;
    if (nextAvail <= nowSec) ready.push(t);
  }
  if (ready.length === 0) {
    const nextSec = nextTaskAvailableSec();
    const waitMin = isFinite(nextSec) ? Math.max(0, Math.round((nextSec - nowSec) / 60)) : 0;
    console.log(`[i] Tasks: tất cả đang cooldown — task kế tiếp sau ~${waitMin} phút.`);
    return nextSec;
  }
  console.log(`[~] Tasks: ${ready.length} sẵn sàng (${ready.map((t) => t.id).join(', ')})`);
  for (const t of ready) {
    try {
      await game.startTask(t.id);
      const waitMs = t.minSeconds * 1000 + rand(5000, 20000);
      console.log(`[+] task ${t.id}: started, chờ ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
      const res = await game.claimTask(t.id);
      if (res && res.status === 'success') {
        console.log(`[+] task ${t.id}: +${res.reward} ATF`);
      } else {
        console.log('[-] task', t.id, ':', (res && (res.message || res.reason)) || 'không success');
      }
    } catch (e) {
      console.log('[-] task', t.id, ':', e.message);
    }
    await humanDelay(120000, 300000); // 2-5 phút giữa các task, giống người
  }
  return nextTaskAvailableSec();
}

async function runCycle() {
  await human.cycleJitter();
  try {
    await ensureFreshInitData();
    await game.login();
  } catch (e) {
    if (
      config.AUTO_REFRESH_INITDATA &&
      /auth_failed|not authorized|user_missing|expired|initdata|hash_mismatch/i.test(e.message)
    ) {
      console.log('[~] Auth problem detected — refreshing initData...');
      await refreshInitData();
      await game.login();
    } else {
      throw e;
    }
  }
  await human.think(600, 1800);
  let user = game.getUser();
  console.log(
    `[i] Level ${user.miner_level || 1} | Pool ${user.mined_balance || 0} ATF | Pending ${user.pending_reward || 0} | last_start ${user.last_mining_start || 0}`
  );

  const difficulty = await fetchDifficulty(user.tg_id);
  const nowSec = Math.floor(Date.now() / 1000);
  const lastStart = parseInt(user.last_mining_start || 0, 10) || 0;

  if (lastStart <= 0) {
    await startMining(user);
    await human.idlePause(4, 12);
    user = game.getUser();
  } else {
    const elapsed = nowSec - lastStart;
    const minClaim = human.claimThreshold();
    if (elapsed >= minClaim) {
      await human.think(1000, 3000);
      try {
        await claimMining(user, difficulty);
      } catch (e) {
        console.log('[-] claim:', e.message);
      }
    } else {
      const next = Math.max(1, Math.ceil((minClaim - elapsed) / 3600));
      console.log(`[i] Will claim in ~${next}h (elapsed ${Math.round(elapsed / 3600)}h of ~${Math.round(minClaim / 3600)}h)`);
    }
    // Task trước, boost sau — boost chỉ chạy trong cửa sổ chờ task kế tiếp
    if (config.AUTO_TASKS) {
      const nextTaskSec = await autoTasks();
      await autoBoost(user, difficulty, nextTaskSec);
    } else {
      await autoBoost(user, difficulty);
    }
  }
}

(async () => {
  console.log('=== ATF Auto Miner ===');
  let cycle = 0;
  while (true) {
    cycle++;
    try {
      console.log(`\n--- Cycle ${cycle} @ ${new Date().toISOString()} ---`);
      await runCycle();
    } catch (e) {
      console.error('[-] Error:', e.message);
    }
    if (human.shouldIdle()) {
      console.log('[~] Idle cycle: skip 1 cycle (như người dùng không mở app)');
      const idleMs = rand(config.LOOP_MIN_MS, config.LOOP_MAX_MS);
      await sleep(idleMs);
      continue;
    }
    const waitMs = rand(config.LOOP_MIN_MS, config.LOOP_MAX_MS);
    console.log(`[=] Next check in ${Math.round(waitMs / 60000)}min`);
    await sleep(waitMs);
  }
})().catch((e) => {
  console.error('[-] Fatal:', e.message);
  process.exit(1);
});
