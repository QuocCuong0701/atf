require('dotenv').config();

const config = {
  apiId: Number(process.env.API_ID || 0),
  apiHash: process.env.API_HASH || '',
  phone: process.env.PHONE || '',
  botUsername: process.env.BOT_USERNAME || 'ATF_AIRDROP_bot',
  startParam: process.env.START_PARAM || '6537113113',
  sessionFile: process.env.SESSION_FILE || 'session/session.txt',
  initDataFile: 'session/initData.txt',

  // --- Auto-play settings (milliseconds / seconds) ---
  LOOP_MIN_MS: 2 * 60 * 1000, // chờ tối thiểu giữa các lần kiểm tra (2 phút)
  LOOP_MAX_MS: 8 * 60 * 1000, // chờ tối đa giữa các lần kiểm tra (8 phút) — khoảng ngẫu nhiên rộng + 15% bỏ lỡ vòng = nhịp không đều giống người hay mở app
  MIN_CLAIM_SECONDS: 6 * 60 * 60, // ngưỡng claim (sẽ được random ±35%)
  AUTO_TASKS: true, // auto 4 task lặp (youtube/x/website/react, +3 ATF mỗi 2h/task)
  AUTO_REFRESH_INITDATA: true, // tự mở lại webview khi initData hết hạn
  // Server mới từ chối initData cũ bằng HTTP 401 reason=hash_mismatch (kiểm tra độ tươi của auth_date).
  // Trước đây 18h vẫn dùng được, giờ phải refresh thường xuyên — đặt 1h cho an toàn.
  INITDATA_MAX_AGE_SECONDS: 60 * 60,

  // --- Auto Boost ("click" tăng speed) ---
  AUTO_BOOST: true, // tự kích hoạt boost khi mining active
  MAX_BOOSTS_PER_SESSION: 300, // giới hạn cứng an toàn cho 1 phiên (+ random 0-2); khi bật AUTO_TASKS, số boost thực tế tự tính theo cửa sổ thời gian còn lại trước task kế tiếp
  BOOST_TASK_MARGIN_SECONDS: 90, // dừng boost sớm hơn task kế tiếp 90s để không lỡ task
  BOOST_SESSION_INTERVAL_MS: 0, // không giới hạn khoảng cách tối thiểu giữa các phiên boost
  BOOST_JITTER_MIN_MS: 5000, // jitter tối thiểu sau khi server hết cooldown — mỗi boost cách nhau ngẫu nhiên 5-8s
  BOOST_JITTER_MAX_MS: 8000, // jitter tối đa sau khi server hết cooldown
  BOOST_MAX_WAIT_MS: 10 * 60 * 1000, // cooldown dài hơn mức này thì dừng phiên, thử lại vòng sau
  BOOST_STALE_LIMIT: 5, // dừng phiên nếu chừng này boost liên tiếp không tăng pending_reward
  BOOST_PENALTY_PAUSE_MS: 45 * 60 * 1000, // nghỉ khi bị server đánh dấu penalty
  BOOST_BUSY_RETRY_LIMIT: 3, // số lần tối đa gặp "Boost is busy right now" trong 1 phiên trước khi dừng (mỗi lần chờ hết boost hiện tại rồi thử lại)
  NETWORK_RETRIES: 3, // số lần thử lại khi lỗi mạng thoáng qua (fetch failed), backoff tăng dần 1.5s→7s

  // --- Human-like behavior ---
  HUMAN_LIKE: true, // bật lớp hành vi giống người
  IDLE_CYCLE_CHANCE: 0.15, // 15% số vòng sẽ "bỏ lỡ" 1 lần kiểm tra
};

module.exports = config;
