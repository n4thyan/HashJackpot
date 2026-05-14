#!/usr/bin/env node
/*
  HashJackpot production server
  No-dependency Node server for a rare-hash leaderboard.

  Security model:
  - Browser is not trusted.
  - Server issues signed challenge tokens.
  - Server recalculates every submitted hash from canonical proof fields.
  - Low-difficulty submissions are rejected before storage.
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || process.env.HJ_PORT || 8787);
const HOST = process.env.HJ_HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.HJ_DATA_DIR || path.join(__dirname, 'data');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const SECRET_FILE = path.join(DATA_DIR, 'server_secret.txt');
const MIN_SUBMIT_BITS = Number(process.env.HJ_MIN_SUBMIT_BITS || 8);
const TOKEN_TTL_HOURS = Number(process.env.HJ_TOKEN_TTL_HOURS || 30);
const MAX_BODY_BYTES = 24 * 1024;
const MAX_SUBMITS_PER_MINUTE = Number(process.env.HJ_RATE_LIMIT || 12);
const MAX_LEADERBOARD_ROWS = Number(process.env.HJ_MAX_ROWS || 100);
const ADMIN_KEY = process.env.HJ_ADMIN_KEY || '';
const TRUST_PROXY = process.env.HJ_TRUST_PROXY === '1';

const VERSION = 'hashjackpot:v1';
const APP_VERSION = '1.14.0';
const SITE_ID = process.env.HJ_SITE_ID || 'nathm.net/hashjackpot';
const RESERVED_NAMES = new Set(String(process.env.HJ_RESERVED_NAMES || 'admin,administrator,moderator,mod,official,staff,support,owner,nathm.net,hashjackpot').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
let SECRET_SOURCE = 'generated-file';

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SUBMISSIONS_FILE)) fs.writeFileSync(SUBMISSIONS_FILE, '[]\n', 'utf8');

function readOrCreateSecret() {
  if (process.env.HJ_SERVER_SECRET && process.env.HJ_SERVER_SECRET.length >= 32) { SECRET_SOURCE = 'environment'; return process.env.HJ_SERVER_SECRET; }
  if (fs.existsSync(SECRET_FILE)) {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (existing.length >= 32) { SECRET_SOURCE = 'data-file'; return existing; }
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated + '\n', { encoding: 'utf8', mode: 0o600 });
  SECRET_SOURCE = 'generated-file';
  return generated;
}

const SERVER_SECRET = readOrCreateSecret();

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hmacHex(input) {
  return crypto.createHmac('sha256', SERVER_SECRET).update(input, 'utf8').digest('hex');
}

function base64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function base64urlDecode(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
}


const DAILY_ADJECTIVES = ['Lucky', 'Neon', 'Zero', 'Quantum', 'Swansea', 'Atomic', 'Mythic', 'Midnight', 'Bright', 'Clean', 'Signal', 'Static'];
const DAILY_NOUNS = ['Bounty', 'Jackpot', 'Proof', 'Run', 'Signal', 'Ticket', 'Receipt', 'Spin', 'Vault', 'Beacon', 'Streak', 'Marker'];
function dailyChallengeName(salt) {
  const a = parseInt(String(salt).slice(0, 2), 16) % DAILY_ADJECTIVES.length;
  const n = parseInt(String(salt).slice(2, 4), 16) % DAILY_NOUNS.length;
  return `${DAILY_ADJECTIVES[a]} ${DAILY_NOUNS[n]}`;
}
function challengeCommitment({ challengeId, salt, startsAt, endsAt }) {
  return sha256Hex(`${VERSION}|public-commitment|${SITE_ID}|${challengeId}|${salt}|${startsAt}|${endsAt}`);
}

function utcDayId(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function challengeForId(challengeId) {
  if (typeof challengeId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(challengeId)) {
    throw new Error('Invalid challengeId. Expected YYYY-MM-DD.');
  }
  const salt = sha256Hex(`${VERSION}|daily-salt|${SITE_ID}|${challengeId}|${SERVER_SECRET}`).slice(0, 64);
  const startsAt = `${challengeId}T00:00:00.000Z`;
  const endsAt = new Date(new Date(startsAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const baseChallenge = { challengeId, salt, startsAt, endsAt };
  return {
    version: VERSION,
    siteId: SITE_ID,
    challengeId,
    challengeName: dailyChallengeName(salt),
    commitment: challengeCommitment(baseChallenge),
    salt,
    startsAt,
    endsAt,
    minSubmitBits: MIN_SUBMIT_BITS,
    lottoJackpotOdds: 45057474,
    lottoJackpotBeatBits: Math.ceil(Math.log2(45057474)),
    tokenTtlHours: TOKEN_TTL_HOURS,
  };
}

function currentChallenge() {
  return challengeForId(utcDayId());
}

function issueToken(playerId) {
  const challenge = currentChallenge();
  const now = Date.now();
  const exp = Math.min(now + TOKEN_TTL_HOURS * 60 * 60 * 1000, new Date(challenge.endsAt).getTime() + 15 * 60 * 1000);
  const payload = {
    v: 1,
    siteId: SITE_ID,
    challengeId: challenge.challengeId,
    playerId,
    issuedAt: new Date(now).toISOString(),
    exp: new Date(exp).toISOString(),
    rnd: crypto.randomBytes(12).toString('hex'),
  };
  const body = base64urlEncode(payload);
  const sig = hmacHex(body);
  return `${body}.${sig}`;
}

function timingEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
  catch { return false; }
}

function verifyToken(token, playerId, challengeId, options = {}) {
  if (typeof token !== 'string' || token.length > 1400 || !token.includes('.')) throw new Error('Invalid challenge token. Refresh and try again.');
  const [body, sig] = token.split('.');
  const expectedSig = hmacHex(body);
  if (!timingEqualHex(sig, expectedSig)) throw new Error('Challenge token signature failed.');
  let payload;
  try { payload = base64urlDecode(body); } catch { throw new Error('Challenge token could not be decoded.'); }
  if (payload.siteId !== SITE_ID) throw new Error('Challenge token belongs to a different site.');
  if (payload.challengeId !== challengeId) throw new Error('Challenge token belongs to a different challenge.');
  if (payload.playerId !== playerId) throw new Error('Challenge token belongs to a different player.');
  if (!options.allowExpired && new Date(payload.exp).getTime() < Date.now()) throw new Error('Challenge token expired. Refresh and try again.');
  return payload;
}

function canonicalPayload({ challengeId, salt, token, playerId, seedHex, nonce }) {
  return [
    VERSION,
    `site=${SITE_ID}`,
    `challenge=${challengeId}`,
    `salt=${salt}`,
    `token=${token}`,
    `player=${playerId}`,
    `seed=${seedHex}`,
    `nonce=${String(nonce)}`,
  ].join('\n');
}

function countLeadingZeroBits(hex) {
  let count = 0;
  for (const ch of hex) {
    const n = parseInt(ch, 16);
    if (n === 0) { count += 4; continue; }
    if (n < 2) return count + 3;
    if (n < 4) return count + 2;
    if (n < 8) return count + 1;
    return count;
  }
  return count;
}

function countLeadingHexZeroes(hex) {
  const match = /^0*/.exec(hex);
  return match ? match[0].length : 0;
}

function cleanName(input) {
  const str = String(input || '').trim().replace(/\s+/g, ' ');
  const safe = str.replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 24).trim();
  if (safe.length < 2) return 'anonymous player';
  const lowered = safe.toLowerCase();
  if (RESERVED_NAMES.has(lowered) || [...RESERVED_NAMES].some(name => name.length >= 4 && lowered.includes(name))) {
    return `not ${safe}`.slice(0, 24);
  }
  return safe;
}

function validatePlayerId(playerId) {
  return typeof playerId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(playerId);
}

function validateSeed(seedHex) {
  return typeof seedHex === 'string' && /^[a-fA-F0-9]{64}$/.test(seedHex);
}

function validateNonce(nonce) {
  if (typeof nonce === 'number') return Number.isSafeInteger(nonce) && nonce >= 0;
  if (typeof nonce === 'string') return /^[0-9]{1,20}$/.test(nonce);
  return false;
}

function cleanHashesTried(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(10_000_000, Math.floor(n));
}

function capHashesTriedForChallenge(value, challenge) {
  const cleaned = cleanHashesTried(value);
  const start = new Date(challenge && challenge.startsAt ? challenge.startsAt : Date.now()).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  // Public counter guard. The page rolls at a visible pace, so absurd jumps get capped.
  const maxReasonable = Math.max(500, elapsedSeconds + 240);
  return Math.min(cleaned, maxReasonable);
}

function readSubmissions() {
  try {
    const rows = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

function writeSubmissions(rows) {
  const tmp = `${SUBMISSIONS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, SUBMISSIONS_FILE);
}

function betterScore(a, b) {
  if (!b) return true;
  if (a.leadingZeroBits !== b.leadingZeroBits) return a.leadingZeroBits > b.leadingZeroBits;
  if (a.hash !== b.hash) return a.hash < b.hash;
  return new Date(a.createdAt).getTime() < new Date(b.createdAt).getTime();
}

function oddsText(bits) {
  if (!Number.isFinite(bits) || bits < 0) return '1 in ?';
  if (bits <= 52) return `1 in ${Number(2n ** BigInt(bits)).toLocaleString('en-GB')}`;
  return `1 in 2^${bits}`;
}


const GLORY_TIERS = [
  { minBits: 0, title: 'Normal Pull' },
  { minBits: 8, title: 'Leaderboard Entry' },
  { minBits: 12, title: 'Clean Hit' },
  { minBits: 16, title: 'Rare Pull' },
  { minBits: 20, title: 'Million Shot' },
  { minBits: 24, title: 'Ridiculous' },
  { minBits: 26, title: 'UK Lotto Beater' },
  { minBits: 32, title: 'Archive Pull' },
];

function gloryTier(leadingZeroBits) {
  const bits = Math.max(0, Number(leadingZeroBits || 0));
  return GLORY_TIERS.filter(t => bits >= t.minBits).pop() || GLORY_TIERS[0];
}

function gloryPoints(leadingZeroBits, leadingHexZeroes = 0) {
  const bits = Math.max(0, Number(leadingZeroBits || 0));
  const hex = Math.max(0, Number(leadingHexZeroes || 0));
  const rarityScore = Math.floor(Math.pow(2, Math.min(bits, 40)) / 1024);
  const zeroBonus = bits * bits;
  const hexBonus = hex * 250;
  const tierBonus = Math.max(0, gloryTier(bits).minBits - 16) * 500;
  return Math.max(1, rarityScore + zeroBonus + hexBonus + tierBonus);
}

function formatGlory(value) {
  const score = Math.max(0, Number(value || 0));
  if (score >= 1_000_000_000) return `${(score / 1_000_000_000).toFixed(2)}B GS`;
  if (score >= 1_000_000) return `${(score / 1_000_000).toFixed(2)}M GS`;
  return `${Math.floor(score).toLocaleString('en-GB')} GS`;
}

function gloryScore(leadingZeroBits, leadingHexZeroes = 0) {
  return formatGlory(gloryPoints(leadingZeroBits, leadingHexZeroes));
}


function publicProofFromRow(row) {
  const challenge = challengeForId(row.challengeId);
  return {
    version: VERSION,
    proofType: 'hashjackpot:public-proof:v3',
    receiptVersion: 3,
    redacted: true,
    siteId: SITE_ID,
    proofId: row.proofId,
    displayName: row.displayName,
    challengeId: row.challengeId,
    challengeName: challenge.challengeName,
    commitment: challenge.commitment,
    salt: challenge.salt,
    playerFingerprint: sha256Hex(`${row.playerId}|${SITE_ID}`).slice(0, 12),
    hash: row.hash,
    leadingZeroBits: row.leadingZeroBits,
    leadingHexZeroes: row.leadingHexZeroes,
    gloryPoints: row.gloryPoints || gloryPoints(row.leadingZeroBits, row.leadingHexZeroes),
    gloryScore: row.gloryScore || gloryScore(row.leadingZeroBits, row.leadingHexZeroes),
    gloryTier: row.gloryTier || gloryTier(row.leadingZeroBits).title,
    odds: oddsText(row.leadingZeroBits),
    hashesTried: cleanHashesTried(row.hashesTried),
    submittedAt: row.createdAt,
    privacy: { redactedFields: ['token', 'seedHex', 'nonce', 'playerId', 'ipHash', 'userAgent'], shareSafe: true },
    verifiedBy: 'server-recomputed stored proof',
    receiptNote: 'Public receipts hide the mining token, seed, nonce and player ID. Use the proofId to ask the server to recompute the stored proof.'
  };
}

function bestRows(rows, scope) {
  const challenge = currentChallenge();
  const visible = rows.filter(r => !r.hiddenAt);
  const filtered = scope === 'daily' ? visible.filter(r => r.challengeId === challenge.challengeId) : visible;
  const byPlayer = new Map();
  for (const row of filtered) {
    const current = byPlayer.get(row.playerId);
    if (betterScore(row, current)) byPlayer.set(row.playerId, row);
  }
  return [...byPlayer.values()].sort((a, b) => {
    if (b.leadingZeroBits !== a.leadingZeroBits) return b.leadingZeroBits - a.leadingZeroBits;
    if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }).slice(0, MAX_LEADERBOARD_ROWS).map((row, index) => ({
    rank: index + 1,
    displayName: row.displayName,
    challengeId: row.challengeId,
    shortHash: `${row.hash.slice(0, 18)}…`,
    hash: row.hash,
    leadingZeroBits: row.leadingZeroBits,
    leadingHexZeroes: row.leadingHexZeroes,
    gloryPoints: row.gloryPoints || gloryPoints(row.leadingZeroBits, row.leadingHexZeroes),
    gloryScore: row.gloryScore || gloryScore(row.leadingZeroBits, row.leadingHexZeroes),
    gloryTier: row.gloryTier || gloryTier(row.leadingZeroBits).title,
    odds: oddsText(row.leadingZeroBits),
    hashesTried: cleanHashesTried(row.hashesTried),
    createdAt: row.createdAt,
    proofId: row.proofId,
  }));
}

function recentRows(rows) {
  return rows
    .filter(r => !r.hiddenAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_LEADERBOARD_ROWS)
    .map((row, index) => ({
      rank: index + 1,
      displayName: row.displayName,
      challengeId: row.challengeId,
      shortHash: `${row.hash.slice(0, 18)}…`,
      hash: row.hash,
      leadingZeroBits: row.leadingZeroBits,
      leadingHexZeroes: row.leadingHexZeroes,
      gloryPoints: row.gloryPoints || gloryPoints(row.leadingZeroBits, row.leadingHexZeroes),
      gloryScore: row.gloryScore || gloryScore(row.leadingZeroBits, row.leadingHexZeroes),
      gloryTier: row.gloryTier || gloryTier(row.leadingZeroBits).title,
      odds: oddsText(row.leadingZeroBits),
      createdAt: row.createdAt,
      proofId: row.proofId,
    }));
}


function attemptsRows(rows) {
  const challenge = currentChallenge();
  const visible = rows.filter(r => !r.hiddenAt && r.challengeId === challenge.challengeId);
  const byPlayer = new Map();
  for (const row of visible) {
    const current = byPlayer.get(row.playerId);
    const rowAttempts = cleanHashesTried(row.hashesTried);
    const currentAttempts = current ? cleanHashesTried(current.hashesTried) : -1;
    if (!current || rowAttempts > currentAttempts || (rowAttempts === currentAttempts && betterScore(row, current))) byPlayer.set(row.playerId, row);
  }
  return [...byPlayer.values()].sort((a, b) => {
    const diff = cleanHashesTried(b.hashesTried) - cleanHashesTried(a.hashesTried);
    if (diff) return diff;
    if (b.leadingZeroBits !== a.leadingZeroBits) return b.leadingZeroBits - a.leadingZeroBits;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }).slice(0, MAX_LEADERBOARD_ROWS).map((row, index) => ({
    rank: index + 1,
    displayName: row.displayName,
    challengeId: row.challengeId,
    shortHash: `${row.hash.slice(0, 18)}…`,
    hash: row.hash,
    leadingZeroBits: row.leadingZeroBits,
    leadingHexZeroes: row.leadingHexZeroes,
    gloryPoints: row.gloryPoints || gloryPoints(row.leadingZeroBits, row.leadingHexZeroes),
    gloryScore: row.gloryScore || gloryScore(row.leadingZeroBits, row.leadingHexZeroes),
    gloryTier: row.gloryTier || gloryTier(row.leadingZeroBits).title,
    odds: oddsText(row.leadingZeroBits),
    hashesTried: cleanHashesTried(row.hashesTried),
    createdAt: row.createdAt,
    proofId: row.proofId,
  }));
}

function statsSummary(rows) {
  const challenge = currentChallenge();
  const visible = rows.filter(r => !r.hiddenAt);
  const dailyRows = visible.filter(r => r.challengeId === challenge.challengeId);
  const topDaily = dailyRows.slice().sort((a, b) => betterScore(a, b) ? -1 : 1)[0] || null;
  const topAll = visible.slice().sort((a, b) => betterScore(a, b) ? -1 : 1)[0] || null;
  const uniquePlayers = new Set(visible.map(r => r.playerId)).size;
  const dailyPlayers = new Set(dailyRows.map(r => r.playerId)).size;
  const last = visible.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  return {
    challengeId: challenge.challengeId,
    totalProofs: visible.length,
    dailyProofs: dailyRows.length,
    uniquePlayers,
    dailyPlayers,
    topDailyBits: topDaily ? topDaily.leadingZeroBits : 0,
    topAllTimeBits: topAll ? topAll.leadingZeroBits : 0,
    topDailyTier: topDaily ? (topDaily.gloryTier || gloryTier(topDaily.leadingZeroBits).title) : 'No tier',
    topAllTimeTier: topAll ? (topAll.gloryTier || gloryTier(topAll.leadingZeroBits).title) : 'No tier',
    lastSubmittedAt: last ? last.createdAt : null,
    totalHashesTried: visible.reduce((sum, row) => sum + cleanHashesTried(row.hashesTried), 0),
    minSubmitBits: MIN_SUBMIT_BITS,
    maxRows: MAX_LEADERBOARD_ROWS,
  };
}



function canAccess(target, mode) {
  try { fs.accessSync(target, mode); return true; }
  catch { return false; }
}

function runtimeStatus(rows = readSubmissions()) {
  const challenge = currentChallenge();
  const visible = rows.filter(r => !r.hiddenAt);
  const hidden = rows.filter(r => r.hiddenAt);
  return {
    appVersion: APP_VERSION,
    protocolVersion: VERSION,
    siteId: SITE_ID,
    serverTime: new Date().toISOString(),
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    environment: {
      host: HOST,
      port: PORT,
      trustProxy: TRUST_PROXY,
      dataDir: process.env.HJ_DATA_DIR ? 'custom HJ_DATA_DIR' : 'bundled data folder',
      secretSource: SECRET_SOURCE,
      adminEnabled: Boolean(ADMIN_KEY),
    },
    storage: {
      dataDirExists: fs.existsSync(DATA_DIR),
      dataDirWritable: canAccess(DATA_DIR, fs.constants.W_OK),
      submissionsFileExists: fs.existsSync(SUBMISSIONS_FILE),
      submissionsReadable: canAccess(SUBMISSIONS_FILE, fs.constants.R_OK),
      submissionsWritable: canAccess(SUBMISSIONS_FILE, fs.constants.W_OK),
      visibleProofs: visible.length,
      hiddenProofs: hidden.length,
    },
    rules: {
      minSubmitBits: MIN_SUBMIT_BITS,
      tokenTtlHours: TOKEN_TTL_HOURS,
      maxSubmitsPerMinute: MAX_SUBMITS_PER_MINUTE,
      maxLeaderboardRows: MAX_LEADERBOARD_ROWS,
      publicReceiptVersion: 3,
    },
    challenge: {
      challengeId: challenge.challengeId,
      challengeName: challenge.challengeName,
      commitment: challenge.commitment,
      endsAt: challenge.endsAt,
    },
    ready: fs.existsSync(DATA_DIR) && canAccess(DATA_DIR, fs.constants.W_OK) && fs.existsSync(SUBMISSIONS_FILE) && canAccess(SUBMISSIONS_FILE, fs.constants.R_OK | fs.constants.W_OK),
  };
}

const rateMap = new Map();
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (TRUST_PROXY && typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
function checkRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = rateMap.get(ip) || { start: now, count: 0 };
  if (now - entry.start > windowMs) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  rateMap.set(ip, entry);
  return entry.count <= MAX_SUBMITS_PER_MINUTE;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  let requested = pathname === '/' ? '/index.html' : pathname;
  requested = decodeURIComponent(requested);
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const cacheControl = filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'interest-cohort=(), geolocation=(), camera=(), microphone=()',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'",
    });
    res.end(data);
  });
}


function requireAdmin(req, body = {}) {
  if (!ADMIN_KEY) throw new Error('Admin moderation is not enabled.');
  const provided = req.headers['x-admin-key'] || body.adminKey || '';
  if (!timingEqualHex(sha256Hex(String(provided)), sha256Hex(ADMIN_KEY))) throw new Error('Invalid admin key.');
}

function adminPublicRow(row) {
  return {
    proofId: row.proofId,
    displayName: row.displayName,
    challengeId: row.challengeId,
    hash: row.hash,
    leadingZeroBits: row.leadingZeroBits,
    leadingHexZeroes: row.leadingHexZeroes,
    gloryScore: row.gloryScore || gloryScore(row.leadingZeroBits, row.leadingHexZeroes),
    gloryTier: row.gloryTier || gloryTier(row.leadingZeroBits).title,
    createdAt: row.createdAt,
    hiddenAt: row.hiddenAt || null,
    hiddenReason: row.hiddenReason || null,
    userAgent: row.userAgent || '',
    ipHash: row.ipHash || '',
  };
}

async function handleApi(req, res, pathname, url) {
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, version: VERSION, appVersion: APP_VERSION, serverTime: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, { ok: true, status: runtimeStatus(), serverTime: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/challenge') {
    const playerId = url.searchParams.get('playerId') || `anon_${crypto.randomBytes(8).toString('hex')}`;
    if (!validatePlayerId(playerId)) return sendJson(res, 400, { ok: false, error: 'Invalid playerId.' });
    const challenge = currentChallenge();
    return sendJson(res, 200, { ok: true, challenge, token: issueToken(playerId), serverTime: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const requested = url.searchParams.get('scope');
    const scope = requested === 'alltime' ? 'alltime' : requested === 'recent' ? 'recent' : requested === 'attempts' ? 'attempts' : 'daily';
    const rows = readSubmissions();
    const boardRows = scope === 'recent' ? recentRows(rows) : scope === 'attempts' ? attemptsRows(rows) : bestRows(rows, scope);
    return sendJson(res, 200, { ok: true, scope, challenge: currentChallenge(), rows: boardRows });
  }

  if (req.method === 'GET' && pathname === '/api/audit') {
    const challenge = currentChallenge();
    return sendJson(res, 200, {
      ok: true,
      audit: {
        appVersion: APP_VERSION,
        protocolVersion: VERSION,
        siteId: SITE_ID,
        minSubmitBits: MIN_SUBMIT_BITS,
        maxLeaderboardRows: MAX_LEADERBOARD_ROWS,
        tokenTtlHours: TOKEN_TTL_HOURS,
        rateLimitPerMinute: MAX_SUBMITS_PER_MINUTE,
        trustProxy: TRUST_PROXY,
        moderationEnabled: Boolean(ADMIN_KEY),
        publicReceiptVersion: 3,
        challenge: { challengeId: challenge.challengeId, challengeName: challenge.challengeName, commitment: challenge.commitment, startsAt: challenge.startsAt, endsAt: challenge.endsAt },
        rules: {
          scoreSource: 'server-recomputed',
          duplicateRule: 'hashes are unique',
          leaderboardRule: 'daily/all-time leaderboards keep best per player; recent leaderboard shows latest verified proofs; hashes tried shows submitted play volume',
          valueRule: 'Local score is cosmetic and exists only for the leaderboard experience',
          publicReceiptRule: 'public receipts hide token, seed, nonce, raw player ID, IP hash and user agent',
        },
      },
      serverTime: new Date().toISOString(),
    });
  }

  if (req.method === 'GET' && pathname === '/api/stats') {
    const rows = readSubmissions();
    return sendJson(res, 200, { ok: true, challenge: currentChallenge(), stats: statsSummary(rows), serverTime: new Date().toISOString() });
  }


  if (req.method === 'GET' && pathname === '/api/proof') {
    const proofId = String(url.searchParams.get('proofId') || '').trim();
    const hash = String(url.searchParams.get('hash') || '').trim().toLowerCase();
    if (!proofId && !hash) return sendJson(res, 400, { ok: false, error: 'Pass proofId or hash.' });
    const rows = readSubmissions();
    const row = rows.find(r => !r.hiddenAt && ((proofId && r.proofId === proofId) || (hash && r.hash === hash)));
    if (!row) return sendJson(res, 404, { ok: false, error: 'Proof not found.' });
    return sendJson(res, 200, { ok: true, proof: publicProofFromRow(row) });
  }

  if (req.method === 'POST' && pathname === '/api/verify') {
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }

    const proof = body.proof && typeof body.proof === 'object' ? body.proof : body;

    // Public leaderboard receipts are redacted so they are safe to share.
    // If a proofId is supplied without the private token/seed fields, verify
    // against the stored server row instead of asking the user to expose them.
    if (proof.proofId && (!proof.token || !proof.seedHex || !proof.playerId)) {
      const rows = readSubmissions();
      const row = rows.find(r => !r.hiddenAt && r.proofId === String(proof.proofId).trim());
      if (!row) return sendJson(res, 404, { ok: false, valid: false, error: 'Public proof not found.' });
      const challenge = challengeForId(row.challengeId);
      const payload = canonicalPayload({ challengeId: row.challengeId, salt: challenge.salt, token: row.token, playerId: row.playerId, seedHex: row.seedHex, nonce: row.nonce });
      const hash = sha256Hex(payload);
      const leadingZeroBits = countLeadingZeroBits(hash);
      const leadingHexZeroes = countLeadingHexZeroes(hash);
      const valid = hash === row.hash;
      return sendJson(res, valid ? 200 : 500, {
        ok: valid,
        valid,
        message: valid ? 'Public proof verified from the stored server receipt.' : 'Stored proof failed recomputation. Check the data file.',
        computed: {
          proofId: row.proofId,
          hash,
          leadingZeroBits,
          leadingHexZeroes,
          odds: oddsText(leadingZeroBits),
          gloryPoints: gloryPoints(leadingZeroBits, leadingHexZeroes),
          gloryScore: gloryScore(leadingZeroBits, leadingHexZeroes),
          gloryTier: gloryTier(leadingZeroBits).title,
          challengeId: row.challengeId,
          siteId: SITE_ID,
          publicReceipt: true,
        },
        publicProof: publicProofFromRow(row),
      });
    }

    const challengeId = String(proof.challengeId || '');
    const playerId = String(proof.playerId || '');
    const token = String(proof.token || '');
    const seedHex = String(proof.seedHex || '').toLowerCase();
    const nonce = String(proof.nonce || '0');
    const submittedHash = proof.hash ? String(proof.hash).toLowerCase() : '';

    let challenge;
    try {
      challenge = challengeForId(challengeId);
      if (!validatePlayerId(playerId)) throw new Error('Invalid playerId.');
      if (!validateSeed(seedHex)) throw new Error('Seed must be 32 random bytes as 64 hex characters.');
      if (!validateNonce(nonce)) throw new Error('Invalid nonce.');
      verifyToken(token, playerId, challengeId, { allowExpired: true });
    } catch (err) {
      return sendJson(res, 400, { ok: false, valid: false, error: err.message });
    }

    const payload = canonicalPayload({ challengeId, salt: challenge.salt, token, playerId, seedHex, nonce });
    const hash = sha256Hex(payload);
    const leadingZeroBits = countLeadingZeroBits(hash);
    const leadingHexZeroes = countLeadingHexZeroes(hash);
    const hashMatches = !submittedHash || submittedHash === hash;

    return sendJson(res, hashMatches ? 200 : 400, {
      ok: hashMatches,
      valid: hashMatches,
      message: hashMatches ? 'Proof verified. The hash is real.' : 'Proof failed. Submitted hash does not match recomputed hash.',
      computed: {
        hash,
        leadingZeroBits,
        leadingHexZeroes,
        odds: oddsText(leadingZeroBits),
        gloryPoints: gloryPoints(leadingZeroBits, leadingHexZeroes), gloryScore: gloryScore(leadingZeroBits, leadingHexZeroes), gloryTier: gloryTier(leadingZeroBits).title,
        challengeId,
        siteId: SITE_ID,
      },
    });
  }

  if (req.method === 'POST' && pathname === '/api/submit') {
    if (!checkRateLimit(req)) return sendJson(res, 429, { ok: false, error: 'Too many submissions. Try again in a minute.' });

    let body;
    try { body = await readJsonBody(req); }
    catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }

    const challenge = currentChallenge();
    const challengeId = String(body.challengeId || '');
    const playerId = String(body.playerId || '');
    const token = String(body.token || '');
    const seedHex = String(body.seedHex || '').toLowerCase();
    const nonce = String(body.nonce || '0');
    const displayName = cleanName(body.displayName);
    let hashesTried = cleanHashesTried(body.hashesTried);

    try {
      if (challengeId !== challenge.challengeId) throw new Error('Only the current daily challenge accepts submissions.');
      if (!validatePlayerId(playerId)) throw new Error('Invalid playerId.');
      if (!validateSeed(seedHex)) throw new Error('Seed must be 32 random bytes as 64 hex characters.');
      if (!validateNonce(nonce)) throw new Error('Invalid nonce.');
      verifyToken(token, playerId, challengeId);
      hashesTried = capHashesTriedForChallenge(hashesTried, challenge);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const payload = canonicalPayload({ challengeId, salt: challenge.salt, token, playerId, seedHex, nonce });
    const hash = sha256Hex(payload);
    const leadingZeroBits = countLeadingZeroBits(hash);
    const leadingHexZeroes = countLeadingHexZeroes(hash);

    if (leadingZeroBits < MIN_SUBMIT_BITS) {
      return sendJson(res, 400, {
        ok: false,
        error: `Valid proof, but not rare enough for the public leaderboard. Need ${MIN_SUBMIT_BITS}+ leading zero bits.`,
        computed: { hash, leadingZeroBits, leadingHexZeroes, odds: oddsText(leadingZeroBits), gloryPoints: gloryPoints(leadingZeroBits, leadingHexZeroes), gloryScore: gloryScore(leadingZeroBits, leadingHexZeroes), gloryTier: gloryTier(leadingZeroBits).title },
      });
    }

    const rows = readSubmissions();
    const duplicate = rows.find(r => r.hash === hash);
    if (duplicate) {
      if (duplicate.playerId === playerId && duplicate.challengeId === challengeId && !duplicate.hiddenAt) {
        duplicate.hashesTried = Math.max(cleanHashesTried(duplicate.hashesTried), hashesTried);
        writeSubmissions(rows);
        return sendJson(res, 200, {
          ok: true,
          message: 'Proof already counted. Spins tried updated.',
          publicProof: publicProofFromRow(duplicate),
          submission: {
            proofId: duplicate.proofId,
            displayName: duplicate.displayName,
            challengeId: duplicate.challengeId,
            hash: duplicate.hash,
            leadingZeroBits: duplicate.leadingZeroBits,
            leadingHexZeroes: duplicate.leadingHexZeroes,
            odds: oddsText(duplicate.leadingZeroBits),
            gloryPoints: duplicate.gloryPoints || gloryPoints(duplicate.leadingZeroBits, duplicate.leadingHexZeroes),
            gloryScore: duplicate.gloryScore || gloryScore(duplicate.leadingZeroBits, duplicate.leadingHexZeroes),
            gloryTier: duplicate.gloryTier || gloryTier(duplicate.leadingZeroBits).title,
            hashesTried: duplicate.hashesTried,
          },
          leaderboard: bestRows(rows, 'daily'),
        });
      }
      return sendJson(res, 409, { ok: false, error: 'That exact proof is already on the leaderboard.' });
    }

    const newRow = {
      proofId: sha256Hex(`${hash}|${playerId}|${challengeId}`).slice(0, 16),
      challengeId,
      playerId,
      displayName,
      seedHex,
      nonce,
      token,
      hash,
      leadingZeroBits,
      leadingHexZeroes,
      odds: oddsText(leadingZeroBits),
      gloryPoints: gloryPoints(leadingZeroBits, leadingHexZeroes), gloryScore: gloryScore(leadingZeroBits, leadingHexZeroes), gloryTier: gloryTier(leadingZeroBits).title,
      hashesTried,
      createdAt: new Date().toISOString(),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
      ipHash: sha256Hex(`${clientIp(req)}|${SERVER_SECRET}`).slice(0, 16),
    };

    const currentBest = rows.filter(r => !r.hiddenAt && r.playerId === playerId && r.challengeId === challengeId).sort((a, b) => betterScore(a, b) ? -1 : 1)[0];
    if (!betterScore(newRow, currentBest)) {
      if (currentBest && hashesTried > cleanHashesTried(currentBest.hashesTried)) {
        currentBest.hashesTried = hashesTried;
        writeSubmissions(rows);
      }
      return sendJson(res, 200, {
        ok: false,
        error: 'Valid proof, but it does not beat your current daily best. Spins tried was still updated.',
        computed: { hash, leadingZeroBits, leadingHexZeroes, odds: oddsText(leadingZeroBits), gloryPoints: gloryPoints(leadingZeroBits, leadingHexZeroes), gloryScore: gloryScore(leadingZeroBits, leadingHexZeroes), gloryTier: gloryTier(leadingZeroBits).title },
        currentBest: currentBest ? { leadingZeroBits: currentBest.leadingZeroBits, hash: currentBest.hash, odds: oddsText(currentBest.leadingZeroBits), hashesTried: cleanHashesTried(currentBest.hashesTried), gloryPoints: currentBest.gloryPoints || gloryPoints(currentBest.leadingZeroBits, currentBest.leadingHexZeroes), gloryTier: currentBest.gloryTier || gloryTier(currentBest.leadingZeroBits).title, gloryScore: currentBest.gloryScore || gloryScore(currentBest.leadingZeroBits, currentBest.leadingHexZeroes) } : null,
      });
    }

    rows.push(newRow);
    writeSubmissions(rows);

    return sendJson(res, 200, {
      ok: true,
      message: 'Proof verified. Score added to the leaderboard.',
      publicProof: publicProofFromRow(newRow),
      submission: {
        proofId: newRow.proofId,
        displayName: newRow.displayName,
        challengeId: newRow.challengeId,
        hash: newRow.hash,
        leadingZeroBits,
        leadingHexZeroes,
        odds: oddsText(leadingZeroBits),
        gloryPoints: gloryPoints(leadingZeroBits, leadingHexZeroes), gloryScore: gloryScore(leadingZeroBits, leadingHexZeroes), gloryTier: gloryTier(leadingZeroBits).title,
        hashesTried: newRow.hashesTried,
      },
      leaderboard: bestRows(rows, 'daily'),
    });
  }


  if (pathname.startsWith('/api/admin/')) {
    let body = {};
    if (req.method === 'POST') {
      try { body = await readJsonBody(req); }
      catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }
    }
    try { requireAdmin(req, body); }
    catch (err) { return sendJson(res, ADMIN_KEY ? 403 : 404, { ok: false, error: err.message }); }

    const rows = readSubmissions();

    if (req.method === 'GET' && pathname === '/api/admin/list') {
      const includeHidden = url.searchParams.get('hidden') === '1';
      const limit = Math.min(250, Math.max(1, Number(url.searchParams.get('limit') || 100)));
      const out = rows
        .filter(row => includeHidden || !row.hiddenAt)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)
        .map(adminPublicRow);
      return sendJson(res, 200, { ok: true, rows: out, moderationEnabled: true });
    }

    if (req.method === 'POST' && pathname === '/api/admin/hide') {
      const proofId = String(body.proofId || '').trim();
      const reason = String(body.reason || 'manual moderation').slice(0, 140);
      if (!proofId) return sendJson(res, 400, { ok: false, error: 'proofId required.' });
      const row = rows.find(r => r.proofId === proofId);
      if (!row) return sendJson(res, 404, { ok: false, error: 'Proof not found.' });
      row.hiddenAt = new Date().toISOString();
      row.hiddenReason = reason;
      writeSubmissions(rows);
      return sendJson(res, 200, { ok: true, message: 'Proof hidden from public leaderboard.', proofId });
    }

    if (req.method === 'POST' && pathname === '/api/admin/unhide') {
      const proofId = String(body.proofId || '').trim();
      if (!proofId) return sendJson(res, 400, { ok: false, error: 'proofId required.' });
      const row = rows.find(r => r.proofId === proofId);
      if (!row) return sendJson(res, 404, { ok: false, error: 'Proof not found.' });
      delete row.hiddenAt;
      delete row.hiddenReason;
      writeSubmissions(rows);
      return sendJson(res, 200, { ok: true, message: 'Proof restored to public leaderboard.', proofId });
    }

    if (req.method === 'POST' && pathname === '/api/admin/rename') {
      const proofId = String(body.proofId || '').trim();
      const displayName = cleanName(body.displayName || 'anonymous player');
      if (!proofId) return sendJson(res, 400, { ok: false, error: 'proofId required.' });
      const row = rows.find(r => r.proofId === proofId);
      if (!row) return sendJson(res, 404, { ok: false, error: 'Proof not found.' });
      row.displayName = displayName;
      row.renamedAt = new Date().toISOString();
      writeSubmissions(rows);
      return sendJson(res, 200, { ok: true, message: 'Display name updated.', proofId, displayName });
    }

    return sendJson(res, 404, { ok: false, error: 'Admin API route not found.' });
  }

  return sendJson(res, 404, { ok: false, error: 'API route not found.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const apiPathname = pathname.startsWith('/hashjackpot/api/')
    ? pathname.replace(/^\/hashjackpot/, '')
    : pathname;

  try {
    if (apiPathname.startsWith('/api/')) return await handleApi(req, res, apiPathname, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { ok: false, error: 'Server error.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`HashJackpot running at http://${HOST}:${PORT}`);
  console.log(`Daily submit threshold: ${MIN_SUBMIT_BITS} leading zero bits`);
});
