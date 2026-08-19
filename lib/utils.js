function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function humanDelay(minMs = 800, maxMs = 2500) {
  return sleep(rand(minMs, maxMs));
}

module.exports = { sleep, rand, humanDelay };
