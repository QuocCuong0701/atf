const config = require('../config');
const { refreshInitData } = require('../lib/webview');

(async () => {
  try {
    const { initData, webviewUrl } = await refreshInitData({ quiet: false });
    console.log('\n[+] WebView URL:\n' + webviewUrl + '\n');
    console.log('[+] initData:\n' + initData + '\n');
    console.log(`[+] initData saved to ${config.initDataFile}`);
  } catch (err) {
    console.error('[-] Fatal:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();
