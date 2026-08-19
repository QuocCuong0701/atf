const fs = require('fs');
const { Api } = require('telegram');
const config = require('../config');
const { createClient } = require('./client');
const { humanDelay, sleep, rand } = require('./utils');

function findWebAppUrlInHistory(history) {
  for (const msg of history) {
    const markup = msg.markup;
    if (!markup || !markup.rows) continue;
    for (const row of markup.rows) {
      if (!row.buttons) continue;
      for (const btn of row.buttons) {
        if (
          btn.url &&
          (btn.className === 'KeyboardButtonWebView' || btn.className === 'KeyboardButtonSimpleWebView')
        ) {
          return btn.url;
        }
      }
    }
  }
  return null;
}

async function refreshInitData({ save = true, quiet = false } = {}) {
  const client = createClient();
  try {
    await client.connect();

    if (!(await client.checkAuthorization())) {
      throw new Error('Not logged in yet. Run: npm run login');
    }

    const peer = await client.getInputEntity(config.botUsername);

    let webappUrl = '';
    try {
      const full = await client.invoke(new Api.users.GetFullUser({ id: peer }));
      const bi = full.fullUser.botInfo;
      if (bi && bi.menuButton && bi.menuButton.url) {
        webappUrl = bi.menuButton.url;
        if (!quiet) console.log('[+] WebApp URL (menu button):', webappUrl);
      }
    } catch (e) {
      if (!quiet) console.log('[!] users.getFullUser failed:', e.message);
    }

    if (!webappUrl) {
      if (!quiet) console.log('[i] No menu-button webapp. Sending /start to find the Play button...');
      await client.invoke(
        new Api.messages.SendMessage({
          peer,
          message: `/start ${config.startParam}`,
          randomId: BigInt(Math.floor(Math.random() * 1e18)),
          noWebpage: true,
        })
      );
      await humanDelay(2000, 4000);

      const history = await client.getMessages(peer, { limit: 6 });
      webappUrl = findWebAppUrlInHistory(history);
      if (webappUrl && !quiet) console.log('[+] WebApp URL (Play button):', webappUrl);
    }

    if (!webappUrl) {
      throw new Error('Could not find webapp URL. Bot may open the app differently.');
    }

    await humanDelay(1200, 3000);

    const res = await client.invoke(
      new Api.messages.RequestWebView({
        peer,
        bot: peer,
        platform: 'web',
        fromTheme: false,
        url: webappUrl,
        startParam: config.startParam,
      })
    );

    const parsed = new URL(res.url);
    let initData = parsed.searchParams.get('tgWebAppData') || '';
    if (!initData && parsed.hash) {
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      initData = hashParams.get('tgWebAppData') || '';
    }

    if (!initData) throw new Error('initData empty from webview.');

    if (save) {
      fs.mkdirSync('session', { recursive: true });
      fs.writeFileSync(config.initDataFile, initData);
      fs.writeFileSync('session/webview.txt', res.url);
      if (!quiet) console.log(`[+] initData saved to ${config.initDataFile} (${initData.length} chars)`);
    }

    await sleep(rand(500, 1200));

    return { initData, webviewUrl: res.url };
  } finally {
    // QUAN TRỌNG: phải dùng destroy() chứ không phải disconnect().
    // disconnect() không set client._destroyed = true, nên vòng keep-alive `_updateLoop`
    // của GramJS vẫn chạy ngầm sau khi refresh xong — ping Telegram mỗi 9s, in
    // "Error: TIMEOUT" khi ping thất bại (console.error trong catch của nó không bị
    // _errorHandler chặn được) và tự reconnect lại, gây spam log + giữ kết nối thừa.
    try {
      await client.destroy();
    } catch (_) {
      // Fallback cho bản GramJS cũ không có destroy()
      client._destroyed = true;
      try {
        await client.disconnect();
      } catch (_) {}
    }
  }
}

module.exports = { refreshInitData, findWebAppUrlInHistory };
