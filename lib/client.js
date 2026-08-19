const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('../config');

function loadSession() {
  if (fs.existsSync(config.sessionFile)) {
    const raw = fs.readFileSync(config.sessionFile, 'utf-8').trim();
    if (raw) return raw;
  }
  return '';
}

function createClient() {
  const session = loadSession();
  const client = new TelegramClient(new StringSession(session), config.apiId, config.apiHash, {
    connectionRetries: 5,
    retryDelay: 2000,
    deviceModel: 'Samsung SM-A515F',
    systemVersion: 'SDK 30',
    appVersion: '9.6.9',
    systemLangCode: 'en',
    langCode: 'en',
  });
  return client;
}

function saveSession(client) {
  fs.mkdirSync(path.dirname(config.sessionFile), { recursive: true });
  fs.writeFileSync(config.sessionFile, client.session.save());
  console.log(`[+] Session saved to ${config.sessionFile}`);
}

module.exports = { createClient, saveSession, loadSession };
