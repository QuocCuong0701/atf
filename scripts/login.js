const config = require('../config');
const { createClient, saveSession } = require('../lib/client');
const { ask } = require('../lib/input');

(async () => {
  if (!config.apiId || !config.apiHash) {
    console.error(
      '[-] Missing API_ID / API_HASH.\n' +
        '    Get them from https://my.telegram.org -> "API development tools".\n' +
        '    Then copy .env.example to .env and fill in the values.'
    );
    process.exit(1);
  }

  const client = createClient();

  await client.start({
    phoneNumber: async () => config.phone || (await ask('[?] Phone number (with country code, e.g. +84901234567): ')),
    password: async () => (await ask('[?] 2FA password (press Enter to skip): ')) || undefined,
    phoneCode: async () => await ask('[?] Code sent to Telegram: '),
    onError: (err) => console.error('[-] Login error:', err),
  });

  const me = await client.getMe();
  console.log(`[+] Logged in as @${me.username || me.firstName} (id: ${me.id})`);
  saveSession(client);
  console.log('[+] Done. Next step: npm run webview');
  process.exit(0);
})().catch((err) => {
  console.error('[-] Fatal:', err.message);
  process.exit(1);
});
