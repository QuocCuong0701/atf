const { sleep, rand } = require('./utils');
const config = require('../config');

const r = (min, max) => rand(min, max);
const chance = (p) => Math.random() < p;

async function preRequest() {
  if (!config.HUMAN_LIKE) return;
  await sleep(r(250, 1100));
  if (chance(0.12)) await sleep(r(1200, 3500));
  if (chance(0.03)) await sleep(r(4000, 9000));
}

async function openApp() {
  console.log('[~] Opening mini-app...');
  await sleep(r(1800, 3800));
  await preRequest();
}

async function think(minMs = 700, maxMs = 2600) {
  if (!config.HUMAN_LIKE) return;
  await sleep(r(minMs, maxMs));
}

async function idlePause(minSec = 8, maxSec = 20) {
  if (!config.HUMAN_LIKE) return;
  await sleep(r(minSec, maxSec) * 1000);
}

async function cycleJitter() {
  if (!config.HUMAN_LIKE) return;
  if (chance(0.5)) await sleep(r(500, 4000));
}

function shouldIdle() {
  if (!config.HUMAN_LIKE) return false;
  return chance(config.IDLE_CYCLE_CHANCE);
}

function claimThreshold() {
  const base = config.MIN_CLAIM_SECONDS;
  return Math.round(base * r(85, 135) / 100);
}

module.exports = { preRequest, openApp, think, idlePause, cycleJitter, shouldIdle, claimThreshold };
