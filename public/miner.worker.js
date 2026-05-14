importScripts('./sha256.js');

let mining = false;
let settings = null;
let best = null;
let attempts = 0;
let startedAt = 0;

function canonicalPayload({ version, siteId, challengeId, salt, token, playerId, seedHex, nonce }) {
  return [
    version,
    `site=${siteId}`,
    `challenge=${challengeId}`,
    `salt=${salt}`,
    `token=${token}`,
    `player=${playerId}`,
    `seed=${seedHex}`,
    `nonce=${String(nonce)}`,
  ].join('\n');
}

function randHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(x => x.toString(16).padStart(2, '0')).join('');
}

function betterScore(a, b) {
  if (!b) return true;
  if (a.leadingZeroBits !== b.leadingZeroBits) return a.leadingZeroBits > b.leadingZeroBits;
  if (a.hash !== b.hash) return a.hash < b.hash;
  return false;
}

function makeCandidate(hash, nonce, bits, hexZeroes) {
  return {
    version: settings.version,
    siteId: settings.siteId,
    challengeId: settings.challengeId,
    salt: settings.salt,
    token: settings.token,
    playerId: settings.playerId,
    seedHex: settings.seedHex,
    nonce: String(nonce),
    hash,
    leadingZeroBits: bits,
    leadingHexZeroes: hexZeroes,
    minedAt: new Date().toISOString(),
  };
}

function mineLoop() {
  if (!mining || !settings) return;
  const batchSize = settings.batchSize || 900;
  let sampleHash = '';
  let localBestChanged = false;

  for (let i = 0; i < batchSize; i++) {
    const nonce = settings.nextNonce++;
    const payload = canonicalPayload({ ...settings, nonce });
    const hash = HashJackpotCrypto.sha256Hex(payload);
    const bits = HashJackpotCrypto.countLeadingZeroBits(hash);
    const hexZeroes = HashJackpotCrypto.countLeadingHexZeroes(hash);
    sampleHash = hash;
    attempts++;

    const candidate = makeCandidate(hash, nonce, bits, hexZeroes);
    if (betterScore(candidate, best)) {
      best = candidate;
      localBestChanged = true;
    }
  }

  if (settings.targetBits && best && best.leadingZeroBits >= settings.targetBits) {
    mining = false;
    postMessage({ type: 'target-hit', attempts, best, sampleHash });
    return;
  }

  const now = performance.now();
  if (localBestChanged || now - settings.lastPostAt > 160) {
    settings.lastPostAt = now;
    const seconds = Math.max(0.001, (now - startedAt) / 1000);
    postMessage({
      type: 'progress',
      attempts,
      hashesPerSecond: Math.round(attempts / seconds),
      sampleHash,
      best,
    });
  }

  setTimeout(mineLoop, 0);
}

self.onmessage = (event) => {
  const msg = event.data || {};

  if (msg.type === 'start') {
    mining = true;
    attempts = 0;
    startedAt = performance.now();
    best = msg.currentBest || null;
    settings = {
      version: msg.version,
      siteId: msg.siteId,
      challengeId: msg.challengeId,
      salt: msg.salt,
      token: msg.token,
      playerId: msg.playerId,
      seedHex: msg.seedHex || randHex(32),
      nextNonce: Number(msg.startNonce || 0),
      batchSize: Number(msg.batchSize || 900),
      targetBits: Number(msg.targetBits || 0),
      lastPostAt: 0,
    };
    postMessage({ type: 'started', seedHex: settings.seedHex });
    mineLoop();
  }

  if (msg.type === 'stop') {
    mining = false;
    postMessage({ type: 'stopped', attempts, best });
  }
};
