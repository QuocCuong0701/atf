const game = require('../lib/game');
const { sleep, rand, humanDelay } = require('../lib/utils');

const REPEATABLE_TASKS = [
  { id: 'youtube_like_comment', minSeconds: 30, note: 'Youtube Like & Comment' },
  { id: 'twitter_retweet', minSeconds: 30, note: 'X Retweet' },
  { id: 'website_visit', minSeconds: 0, note: 'Visit Website' },
  { id: 'telegram_react_latest', minSeconds: 20, note: 'React to latest post' },
];

const nowSec = () => Math.floor(Date.now() / 1000);

function fmtCooldown(secs) {
  if (secs <= 0) return 'sẵn sàng';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}m`;
}

async function probe() {
  console.log('=== Probe tasks ===');
  await game.login();
  const user = game.getUser();
  const state = game.getTaskState();
  console.log(`[i] tg_id: ${user.tg_id} | level: ${user.miner_level || 1} | mined: ${user.mined_balance} ATF`);
  console.log('[i] completed_tasks:', (user.completed_tasks || []).join(', ') || '(none)');
  console.log('[i] react_post:', state.reactPost ? JSON.stringify(state.reactPost) : '(none)');

  for (const t of REPEATABLE_TASKS) {
    console.log(`\n--- ${t.note} (${t.id}) ---`);
    const cd = state.taskCooldowns && state.taskCooldowns[t.id];
    const nextAvail = cd ? parseInt(cd, 10) || 0 : 0;
    if (nextAvail > nowSec()) {
      console.log(`[i] Đang cooldown, còn ${fmtCooldown(nextAvail - nowSec())} — bỏ qua.`);
      continue;
    }
    try {
      const startedAt = nowSec();
      const start = await game.startTask(t.id, startedAt);
      console.log('[+] start_task ->', JSON.stringify(start));
      const waitMs = t.minSeconds * 1000 + rand(5000, 15000);
      console.log(`[~] Chờ ${Math.round(waitMs / 1000)}s (min ${t.minSeconds}s + jitter)...`);
      await sleep(waitMs);
      const res = await game.claimTask(t.id);
      console.log('[+] claim_task ->', JSON.stringify(res));
      console.log(
        `[i] reward: ${res.reward} | new_balance: ${res.new_balance} | repeatable: ${res.repeatable || false} | next_available: ${res.next_available || '-'}`
      );
    } catch (e) {
      console.log('[-] FAIL:', e.message);
      if (e.data) console.log('[-] data:', JSON.stringify(e.data));
    }
    if (t.id !== REPEATABLE_TASKS[REPEATABLE_TASKS.length - 1].id) {
      const gapMs = rand(60000, 180000);
      console.log(`[~] Nghỉ ${Math.round(gapMs / 60000)} phút trước task kế...`);
      await sleep(gapMs);
    }
  }
  console.log('\n=== Done. Kiểm tra balance/pending ở lần chạy npm start kế. ===');
  process.exit(0);
}

probe().catch((e) => {
  console.error('[-] Fatal:', e.message);
  process.exit(1);
});
