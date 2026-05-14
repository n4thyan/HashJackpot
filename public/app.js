/* HashJackpot frontend. Plain JavaScript, no framework dependency. */
(() => {
  'use strict';

  const LOTTO_JACKPOT_ODDS = 45057474; // UK Lotto jackpot odds, match 6 numbers
  const LOTTO_BEAT_BITS = Math.ceil(Math.log2(LOTTO_JACKPOT_ODDS));
  const LOTTO_TIERS = [
    { label: 'UK Lotto Match 3', odds: 96 },
    { label: 'UK Lotto Match 4', odds: 2180 },
    { label: 'UK Lotto Match 5', odds: 144415 },
    { label: 'UK Lotto 5 + Bonus', odds: 7509579 },
    { label: 'UK Lotto Jackpot', odds: LOTTO_JACKPOT_ODDS },
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status'),
    challenge: $('challenge'),
    salt: $('salt'),
    reels: $('reels'),
    pull: $('pull'),
    turbo: $('turbo'),
    stop: $('stop'),
    submit: $('submit'),
    refreshBoard: $('refreshBoard'),
    scopeDaily: $('scopeDaily'),
    scopeAll: $('scopeAll'),
    scopeRecent: $('scopeRecent'),
    scopeAttempts: $('scopeAttempts'),
    playerName: $('playerName'),
    bestHash: $('bestHash'),
    bestBits: $('bestBits'),
    todayBest: $('todayBest'),
    bestHex: $('bestHex'),
    bestOdds: $('bestOdds'),
    hashesTried: $('hashesTried'),
    speed: $('speed'),
    verdict: $('verdict'),
    proofFreshness: $('proofFreshness'),
    proofBox: $('proofBox'),
    verifyProof: $('verifyProof'),
    verifyResult: $('verifyResult'),
    leaderboardBody: $('leaderboardBody'),
    leaderboardEmpty: $('leaderboardEmpty'),
    leaderboardFlex: $('leaderboardFlex'),
    submitResult: $('submitResult'),
    ladder: $('ladder'),
    apiNotice: $('apiNotice'),
    heroMeter: $('heroMeter'),
    heroMeterText: $('heroMeterText'),
    latestBits: $('latestBits'),
    latestOdds: $('latestOdds'),
    latestVerdict: $('latestVerdict'),
    latestGlory: $('latestGlory'),
    serverStats: $('serverStats'),
    achievements: $('achievements'),
    latestTier: $('latestTier'),
    proofPoints: $('proofPoints'),
    proofTier: $('proofTier'),
    gloryVault: $('gloryVault'),
    gloryVaultBig: $('gloryVaultBig'),
    gloryRank: $('gloryRank'),
    gloryRankSmall: $('gloryRankSmall'),
    nextGloryRank: $('nextGloryRank'),
    gloryFormula: $('gloryFormula'),
    gloryEvents: $('gloryEvents'),
    recentPulls: $('recentPulls'),
    copyProof: $('copyProof'),
    resetLocal: $('resetLocal'),
    shareResult: $('shareResult'),
    timeLeft: $('timeLeft'),
    minSubmitBits: $('minSubmitBits'),
    turboTarget: $('turboTarget'),
    targetHint: $('targetHint'),
    copyExplainer: $('copyExplainer'),
    copyProofLink: $('copyProofLink'),
    dailyBounty: $('dailyBounty'),
    dailyBountyTile: $('dailyBountyTile'),
    dailyBountySmall: $('dailyBountySmall'),
    bountyStatus: $('bountyStatus'),
    challengeName: $('challengeName'),
    commitment: $('commitment'),
    proofInspector: $('proofInspector'),
    welcomeCard: $('welcomeCard'),
    dismissWelcome: $('dismissWelcome'),
    auditPanel: $('auditPanel'),
    launchStatus: $('launchStatus'),
    submitHint: $('submitHint'),
    copyMathExplain: $('copyMathExplain'),
    achievementCount: $('achievementCount'),
    upgradeGrid: $('upgradeGrid'),
    jackpotGrade: $('jackpotGrade'),
    nextTarget: $('nextTarget'),
    sessionPeak: $('sessionPeak'),
    hotPulls: $('hotPulls'),
    tickerBoard: $('tickerBoard'),
    tickerFloor: $('tickerFloor'),
    tickerTarget: $('tickerTarget'),
    boardStatusTile: $('boardStatusTile'),
    boardStatusSmall: $('boardStatusSmall'),
    retryApi: $('retryApi'),
    copyBoardLink: $('copyBoardLink'),
    copyResultProof: $('copyResultProof'),
    resultExplain: $('resultExplain'),
  };


  const STORAGE_SCHEMA_VERSION = '8';
  const SPIN_COOLDOWN_MS = 1200;
  const AUTO_SPIN_INTERVAL_MS = 1600;

  function resetLegacyLocalStatsForV113() {
    const version = localStorage.getItem('hj_schema_version');
    if (version === STORAGE_SCHEMA_VERSION) return false;
    const keepPlayerId = localStorage.getItem('hj_player_id');
    const keepName = localStorage.getItem('hj_display_name');
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('hj_')) localStorage.removeItem(key);
    });
    if (keepPlayerId) localStorage.setItem('hj_player_id', keepPlayerId);
    if (keepName) localStorage.setItem('hj_display_name', keepName);
    localStorage.setItem('hj_schema_version', STORAGE_SCHEMA_VERSION);
    sessionStorage.setItem('hj_v113_reset_notice', '1');
    return true;
  }

  resetLegacyLocalStatsForV113();

  const state = {
    apiOk: false,
    challenge: null,
    token: null,
    playerId: getOrCreatePlayerId(),
    best: loadJson('hj_best'),
    dailyBest: null,
    recent: Array.isArray(loadJson('hj_recent')) ? loadJson('hj_recent') : [],
    glory: Number(localStorage.getItem('hj_glory') || 0),
    gloryEvents: Array.isArray(loadJson('hj_glory_events')) ? loadJson('hj_glory_events') : [],
    awardedHashes: Array.isArray(loadJson('hj_awarded_hashes')) ? loadJson('hj_awarded_hashes') : [],
    proofPinned: false,
    attempts: Number(localStorage.getItem('hj_attempts') || 0),
    attemptKey: 'hj_attempts',
    nextAllowedSpinAt: 0,
    worker: null,
    autoTimer: null,
    autoStartedAt: 0,
    mining: false,
    turboBaseline: 0,
    stopTimer: null,
    leaderboardScope: 'daily',
    latest: null,
    countdownTimer: null,
    hashRate: 0,
    loadedProofId: null,
    dailyBountyBits: 0,
    seenAchievements: Array.isArray(loadJson('hj_seen_achievements')) ? loadJson('hj_seen_achievements') : [],
    achievementsBooted: false,
    sessionPeak: 0,
  };

  function getOrCreatePlayerId() {
    let id = localStorage.getItem('hj_player_id');
    if (!id) {
      const arr = new Uint8Array(12);
      crypto.getRandomValues(arr);
      id = 'anon_' + [...arr].map(x => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('hj_player_id', id);
    }
    return id;
  }

  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function migrateLocalStorage() {
    const version = localStorage.getItem('hj_schema_version');
    if (version === STORAGE_SCHEMA_VERSION) return;
    const clampArray = (key, max) => {
      const value = loadJson(key);
      if (Array.isArray(value)) saveJson(key, value.slice(0, max));
      else if (value !== null) localStorage.removeItem(key);
    };
    clampArray('hj_recent', 12);
    clampArray('hj_glory_events', 12);
    clampArray('hj_awarded_hashes', 400);
    clampArray('hj_seen_achievements', 120);
    if (!Number.isFinite(Number(localStorage.getItem('hj_glory') || 0))) localStorage.setItem('hj_glory', '0');
    if (!Number.isFinite(Number(localStorage.getItem('hj_attempts') || 0))) localStorage.setItem('hj_attempts', '0');
    localStorage.setItem('hj_schema_version', STORAGE_SCHEMA_VERSION);
  }

  function todayKey(challengeId) {
    return `hj_daily_best_${challengeId}`;
  }

  function randHex(bytes = 32) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return [...arr].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function canonicalPayload({ version, siteId, challengeId, salt, token, playerId, seedHex, nonce }) {
    return [
      version || 'hashjackpot:v1',
      `site=${siteId || 'nathm.net/hashjackpot'}`,
      `challenge=${challengeId}`,
      `salt=${salt}`,
      `token=${token}`,
      `player=${playerId}`,
      `seed=${seedHex}`,
      `nonce=${String(nonce)}`,
    ].join('\n');
  }

  function makeCandidate(seedHex, nonce) {
    const proofBase = {
      version: state.challenge.version,
      siteId: state.challenge.siteId,
      challengeId: state.challenge.challengeId,
      salt: state.challenge.salt,
      token: state.token,
      playerId: state.playerId,
      seedHex,
      nonce: String(nonce),
    };
    const hash = HashJackpotCrypto.sha256Hex(canonicalPayload(proofBase));
    return {
      ...proofBase,
      hash,
      leadingZeroBits: HashJackpotCrypto.countLeadingZeroBits(hash),
      leadingHexZeroes: HashJackpotCrypto.countLeadingHexZeroes(hash),
      minedAt: new Date().toISOString(),
    };
  }

  function isCurrentProof(proof) {
    return Boolean(proof && state.challenge && proof.challengeId === state.challenge.challengeId && proof.playerId === state.playerId && proof.token);
  }

  function betterScore(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.leadingZeroBits !== b.leadingZeroBits) return a.leadingZeroBits > b.leadingZeroBits;
    if (a.hash !== b.hash) return a.hash < b.hash;
    return false;
  }

  function oddsFromBits(bits) {
    if (!Number.isFinite(bits) || bits < 0) return 1;
    return Math.pow(2, Math.min(bits, 53));
  }

  function formatInt(n) {
    if (!Number.isFinite(n)) return String(n);
    return Math.round(n).toLocaleString('en-GB');
  }

  const GLORY_TIERS = [
    { minBits: 0, title: 'Normal Pull', badge: 'dust', note: 'common result' },
    { minBits: 8, title: 'Leaderboard Entry', badge: 'warm', note: 'good enough to submit' },
    { minBits: 12, title: 'Clean Hit', badge: 'warm-reels', note: 'about 1 in 4,096' },
    { minBits: 16, title: 'Rare Pull', badge: 'board', note: 'about 1 in 65,536' },
    { minBits: 20, title: 'Million Shot', badge: 'lotto', note: 'about 1 in 1,048,576' },
    { minBits: 24, title: 'Ridiculous', badge: 'seven-zero', note: 'about 1 in 16.7 million' },
    { minBits: 26, title: 'UK Lotto Beater', badge: 'mythic', note: 'rarer than UK Lotto jackpot odds' },
    { minBits: 32, title: 'Archive Pull', badge: 'impossible', note: 'serious long-odds proof' },
  ];

  const GLORY_RANKS = [
    { min: 0, title: 'No score yet' },
    { min: 1_000, title: 'Warm Starter' },
    { min: 25_000, title: 'Reel Runner' },
    { min: 100_000, title: 'Proof Regular' },
    { min: 500_000, title: 'Zero Baron' },
    { min: 2_000_000, title: 'Odds Chaser' },
    { min: 10_000_000, title: 'Zero Specialist' },
    { min: 100_000_000, title: 'Proof Collector' },
  ];

  const ACHIEVEMENTS = [
    { id: 'first_pull', title: 'First Pull', note: 'Pull the lever once.', unlocked: () => state.attempts > 0 },
    { id: 'ten_pulls', title: 'First Ten', note: 'Make 10 spins.', unlocked: () => state.attempts >= 10 },
    { id: 'hundred_pulls', title: 'Warm Cabinet', note: 'Make 100 spins.', unlocked: () => state.attempts >= 100 },
    { id: 'two_hundred_pulls', title: 'Two Hundred Pulls', note: 'Make 200 spins.', unlocked: () => state.attempts >= 200 },
    { id: 'five_hundred_pulls', title: 'Patient Player', note: 'Make 500 spins.', unlocked: () => state.attempts >= 500 },
    { id: 'first_glory', title: 'Score Started', note: 'Earn your first local score.', unlocked: () => state.glory > 0 },
    { id: 'glory_10k', title: 'Ten Grand Cabinet', note: 'Reach 10,000 local score.', unlocked: () => state.glory >= 10000 },
    { id: 'glory_100k', title: 'Six-Figure Glow', note: 'Reach 100,000 local score.', unlocked: () => state.glory >= 100000 },
    { id: 'glory_1m', title: 'Million Light', note: 'Reach 1,000,000 local score.', unlocked: () => state.glory >= 1000000 },
    { id: 'warm_hash', title: 'Warm Hash', note: 'Hit 8+ leading zero bits.', unlocked: () => (state.best?.leadingZeroBits || 0) >= 8 },
    { id: 'twelve_bits', title: 'Clean Dozen', note: 'Hit 12+ leading zero bits.', unlocked: () => (state.best?.leadingZeroBits || 0) >= 12 },
    { id: 'sixteen_bits', title: 'Sixteen Bits', note: 'Hit 16+ leading zero bits.', unlocked: () => (state.best?.leadingZeroBits || 0) >= 16 },
    { id: 'twenty_bits', title: 'Million Shot', note: 'Hit 20+ leading zero bits.', unlocked: () => (state.best?.leadingZeroBits || 0) >= 20 },
    { id: 'board_ready', title: 'Leaderboard Ready', note: 'Find a result rare enough for the public leaderboard.', unlocked: () => Boolean(state.challenge && (state.dailyBest?.leadingZeroBits || 0) >= state.challenge.minSubmitBits) },
    { id: 'bounty_hit', title: 'Bounty Hit', note: 'Beat the daily side target.', unlocked: () => (state.dailyBest?.leadingZeroBits || 0) >= (state.dailyBountyBits || 999) },
    { id: 'lotto_beater', title: 'UK Lotto Beater', note: 'Generate a proof rarer than UK Lotto jackpot odds.', unlocked: () => (state.best?.leadingZeroBits || 0) >= LOTTO_BEAT_BITS },
    { id: 'four_hex', title: 'Four-Zero Flash', note: 'Hit 4 leading hex zeroes.', unlocked: () => (state.best?.leadingHexZeroes || 0) >= 4 },
    { id: 'five_hex', title: 'Five-Zero Run', note: 'Hit 5 leading hex zeroes.', unlocked: () => (state.best?.leadingHexZeroes || 0) >= 5 },
    { id: 'seven_zero', title: 'Seven-Zero Run', note: 'Hit 7 leading hex zeroes.', unlocked: () => (state.best?.leadingHexZeroes || 0) >= 7 },
    { id: 'mythic_zero', title: 'Mythic Zero', note: 'Hit 32+ leading zero bits.', unlocked: () => (state.best?.leadingZeroBits || 0) >= 32 },
    { id: 'recent_six', title: 'Spin Tape Filled', note: 'Fill the recent spin tape.', unlocked: () => state.recent.length >= 6 },
    { id: 'api_online', title: 'Live Cabinet', note: 'Connect to the public API.', unlocked: () => state.apiOk },
    { id: 'name_saved', title: 'Name on the Glass', note: 'Save a display name.', unlocked: () => Boolean((els.playerName?.value || localStorage.getItem('hj_display_name') || '').trim()) },
    { id: 'one_thousand_pulls', title: 'Thousand Club', note: 'Make 1,000 spins.', unlocked: () => state.attempts >= 1000 },
    { id: 'two_thousand_pulls', title: 'Two Thousand Club', note: 'Make 2,000 spins.', unlocked: () => state.attempts >= 2000 },
    { id: 'five_thousand_pulls', title: 'Five Thousand Club', note: 'Make 5,000 spins.', unlocked: () => state.attempts >= 5000 },
    { id: 'glory_10m', title: 'Ten Million Glow', note: 'Reach 10,000,000 local score.', unlocked: () => state.glory >= 10000000 },
    { id: 'twenty_four_bits', title: 'Clean Machine', note: 'Hit 24+ leading zero bits.', unlocked: () => (state.best?.leadingZeroBits || 0) >= 24 },
    { id: 'thirty_six_bits', title: 'Cold Miracle', note: 'Hit 36+ leading zero bits.', unlocked: () => (state.best?.leadingZeroBits || 0) >= 36 },
    { id: 'six_hex', title: 'Six-Zero Stamp', note: 'Hit 6 leading hex zeroes.', unlocked: () => (state.best?.leadingHexZeroes || 0) >= 6 },
    { id: 'eight_hex', title: 'Eight-Zero Glass', note: 'Hit 8 leading hex zeroes.', unlocked: () => (state.best?.leadingHexZeroes || 0) >= 8 },
    { id: 'hot_tape', title: 'Hot Tape', note: 'Hold three 8+ bit pulls in the recent tape.', unlocked: () => state.recent.filter(r => Number(r.leadingZeroBits || 0) >= 8).length >= 3 },
    { id: 'session_16', title: 'Good Session', note: 'Hit 16+ bits in this session.', unlocked: () => state.sessionPeak >= 16 },
    { id: 'steady_auto', title: 'Steady Auto', note: 'Run auto spin for a clean session.', unlocked: () => state.mining && state.attempts - state.turboBaseline >= 20 },
    { id: 'board_refresh', title: 'Leaderboard Watcher', note: 'Open the verified leaderboard while the API is online.', unlocked: () => state.apiOk && state.leaderboardScope === 'daily' },
  ];

  const CABINET_UPGRADES = [
    { id: 'starter', title: 'Starter Cabinet', requirement: 'Start the machine', unlocked: () => true },
    { id: 'lamps', title: 'Side Lamps', requirement: 'Earn 1,000 GS', unlocked: () => state.glory >= 1000 },
    { id: 'marquee', title: 'Gold Marquee', requirement: 'Hit 12+ bits', unlocked: () => (state.best?.leadingZeroBits || 0) >= 12 },
    { id: 'turbo', title: 'Turbo Button', requirement: 'Make 100 pulls', unlocked: () => state.attempts >= 100 },
    { id: 'receipt', title: 'Receipt Window', requirement: 'Reach leaderboard floor', unlocked: () => Boolean(state.challenge && (state.dailyBest?.leadingZeroBits || 0) >= state.challenge.minSubmitBits) },
    { id: 'jackpot', title: 'Jackpot Glass', requirement: 'Beat UK Lotto odds', unlocked: () => (state.best?.leadingZeroBits || 0) >= LOTTO_BEAT_BITS },
    { id: 'neon', title: 'Neon Trim', requirement: 'Reach 1,000,000 GS', unlocked: () => state.glory >= 1000000 },
    { id: 'blackcard', title: 'Black Glass', requirement: 'Hit 32+ bits', unlocked: () => (state.best?.leadingZeroBits || 0) >= 32 },
  ];

  function gloryTier(bits) {
    const safeBits = Math.max(0, Number(bits || 0));
    return GLORY_TIERS.filter(t => safeBits >= t.minBits).pop() || GLORY_TIERS[0];
  }

  function gloryRank(value) {
    const safe = Math.max(0, Number(value || 0));
    return GLORY_RANKS.filter(r => safe >= r.min).pop() || GLORY_RANKS[0];
  }

  function nextGloryRank(value) {
    const safe = Math.max(0, Number(value || 0));
    return GLORY_RANKS.find(r => r.min > safe) || null;
  }

  function gloryForProof(proof) {
    if (!proof) return 0;
    const bits = Math.max(0, Number(proof.leadingZeroBits || 0));
    const hex = Math.max(0, Number(proof.leadingHexZeroes || 0));
    // Cosmetic arcade score only. Formula: odds/1024 + skill label bonuses. Never money.
    const rarityScore = Math.floor(Math.pow(2, Math.min(bits, 40)) / 1024);
    const zeroBonus = bits * bits;
    const hexBonus = hex * 250;
    const tier = gloryTier(bits);
    const tierBonus = Math.max(0, tier.minBits - 16) * 500;
    return Math.max(1, rarityScore + zeroBonus + hexBonus + tierBonus);
  }

  function formatGlory(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0 GS';
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B GS`; 
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M GS`; 
    return `${Math.floor(n).toLocaleString('en-GB')} GS`; 
  }

  function gloryLine(proof) {
    if (!proof) return '0 GS · No score yet';
    const tier = gloryTier(proof.leadingZeroBits);
    return `${formatGlory(gloryForProof(proof))} · ${tier.title}`;
  }

  function awardGlory(candidate) {
    if (!candidate || !candidate.hash) return 0;
    if (state.awardedHashes.includes(candidate.hash)) return 0;
    const points = gloryForProof(candidate);
    state.glory += points;
    state.awardedHashes.unshift(candidate.hash);
    state.awardedHashes = state.awardedHashes.slice(0, 400);
    const tier = gloryTier(candidate.leadingZeroBits);
    state.gloryEvents.unshift({
      hash: candidate.hash,
      bits: candidate.leadingZeroBits,
      hex: candidate.leadingHexZeroes,
      points,
      tier: tier.title,
      at: new Date().toISOString(),
    });
    state.gloryEvents = state.gloryEvents.slice(0, 12);
    localStorage.setItem('hj_glory', String(Math.floor(state.glory)));
    saveJson('hj_awarded_hashes', state.awardedHashes);
    saveJson('hj_glory_events', state.gloryEvents);
    return points;
  }

  function oddsText(bits) {
    if (!Number.isFinite(bits)) return '1 in ?';
    if (bits <= 52) return `1 in ${formatInt(Math.pow(2, bits))}`;
    return `1 in 2^${bits}`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'unknown time';
    if (seconds < 60) return `~${Math.ceil(seconds)}s`;
    if (seconds < 3600) return `~${Math.ceil(seconds / 60)}m`;
    if (seconds < 86400) return `~${(seconds / 3600).toFixed(1)}h`;
    if (seconds < 31557600) return `~${(seconds / 86400).toFixed(1)} days`;
    return `~${(seconds / 31557600).toFixed(1)} years`;
  }

  function compactTimeAgo(iso) {
    if (!iso) return 'none yet';
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (!Number.isFinite(seconds)) return 'unknown';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function expectedTimeText(bits) {
    if (!bits || bits <= 0) return 'Every spin is one fresh chance.';
    const spins = Math.pow(2, Math.min(bits, 53));
    return `Average wait: about ${formatInt(spins)} spins. At the site pace that is around ${formatDuration(spins)}.`;
  }

  function dailyBountyFromChallenge(challenge) {
    if (!challenge || !challenge.salt) return 0;
    const n = parseInt(String(challenge.salt).slice(0, 4), 16);
    const floor = Number(challenge.minSubmitBits || 20);
    const offset = Number.isFinite(n) ? (n % 6) : 0;
    return Math.max(floor + 1, 21 + offset);
  }

  function updateBountyPanel() {
    const bits = state.dailyBountyBits || 0;
    const bestBits = Number(state.dailyBest?.leadingZeroBits || 0);
    const won = bits > 0 && bestBits >= bits;
    const text = bits ? `${bits}+ bits` : 'loading…';
    if (els.dailyBounty) {
      els.dailyBounty.textContent = text;
      els.dailyBounty.classList.toggle('bounty-won', won);
    }
    if (els.dailyBountyTile) els.dailyBountyTile.textContent = text;
    if (els.dailyBountySmall) els.dailyBountySmall.textContent = won ? 'Bounty cleared today' : 'Salt-derived side target';
    if (els.bountyStatus) {
      if (!bits) els.bountyStatus.textContent = 'Daily bounty loading…';
      else if (won) els.bountyStatus.textContent = `Daily bounty cleared: ${bestBits}/${bits} zero bits.`;
      else els.bountyStatus.textContent = `Daily bounty: hit ${bits}+ zero bits today. Current best: ${bestBits}/${bits}. ${expectedTimeText(bits)}`;
    }
  }


  function updateSubmitReadiness() {
    if (!els.submitHint || !els.submit || !state.challenge) return;
    if (!state.apiOk) {
      els.submitHint.textContent = 'Public submission unlocks when the leaderboard is online.';
      els.submitHint.className = 'submit-hint blocked';
      els.submit.disabled = true;
      return;
    }
    const bits = Number(state.dailyBest?.leadingZeroBits || 0);
    const need = Number(state.challenge.minSubmitBits || 20);
    if (bits >= need) {
      els.submitHint.textContent = `Ready to submit: ${bits}/${need}+ zero bits. The server will check the proof again.`;
      els.submitHint.className = 'submit-hint ready';
      els.submit.disabled = false;
    } else {
      els.submitHint.textContent = `Need ${need}+ zero bits for the public leaderboard. Current daily best: ${bits} bits.`;
      els.submitHint.className = 'submit-hint blocked';
      els.submit.disabled = true;
    }
  }

  function targetBitsForSelection() {
    if (!state.challenge) return 0;
    const value = els.turboTarget.value;
    if (value === 'submit') return Number(state.challenge.minSubmitBits || 20);
    if (value === 'bounty') return Number(state.dailyBountyBits || dailyBountyFromChallenge(state.challenge) || 0);
    if (value === 'lotto') return Number(state.challenge.lottoJackpotBeatBits || LOTTO_BEAT_BITS);
    return 0;
  }

  function updateTargetHint() {
    const bits = targetBitsForSelection();
    if (!bits) {
      els.targetHint.textContent = 'Auto spin rolls one visible hash at a steady pace until you press Stop.';
      return;
    }
    if (els.turboTarget.value === 'bounty') {
      els.targetHint.textContent = `${bits} zero bits daily bounty. Auto stops when the target is hit. ${expectedTimeText(bits)}`;
    } else if (bits >= LOTTO_BEAT_BITS) {
      els.targetHint.textContent = `${bits} zero bits target. Auto stops after beating UK Lotto jackpot odds. ${expectedTimeText(bits)}`;
    } else {
      els.targetHint.textContent = `${bits} zero bits target. Auto stops when it finds a leaderboard-ready hash. ${expectedTimeText(bits)}`;
    }
  }

  function updateCountdown() {
    if (!state.challenge || !state.challenge.endsAt) {
      els.timeLeft.textContent = 'unknown';
      return;
    }
    const ms = new Date(state.challenge.endsAt).getTime() - Date.now();
    if (ms <= 0) {
      els.timeLeft.textContent = 'refresh';
      return;
    }
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    els.timeLeft.textContent = `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  }

  function comparisonText(bits) {
    const odds = oddsFromBits(bits);
    const beaten = LOTTO_TIERS.filter(t => odds >= t.odds).pop();
    if (odds >= LOTTO_JACKPOT_ODDS) return 'You beat UK Lotto jackpot odds. That is a serious leaderboard flex.';
    if (beaten) return `Rarer than ${beaten.label}. Arcade score only.`;
    if (bits < 8) return 'A normal hash. Keep spinning.';
    return 'Getting warmer. Higher zero-bit counts are much harder.';
  }

  function setStatus(text) { els.status.textContent = text; }

  function updateBoardStatusTile() {
    if (!els.boardStatusTile) return;
    els.boardStatusTile.textContent = state.apiOk ? 'online' : 'local';
    els.boardStatusTile.className = state.apiOk ? 'api-online' : 'api-offline';
    if (els.boardStatusSmall) els.boardStatusSmall.textContent = state.apiOk ? 'Verified leaderboard live' : 'Spins still work';
    if (els.retryApi) els.retryApi.hidden = state.apiOk;
  }

  function updateReels(hash, rolling = false) {
    const chars = (hash || '????????????').slice(0, 12).padEnd(12, '?').split('');
    els.reels.innerHTML = chars.map((ch, i) => `<span class="reel ${ch === '0' ? 'zero' : ''} ${rolling ? 'rolling' : ''}" style="--i:${i}">${escapeHtml(ch)}</span>`).join('');
  }

  function currentProofForBox() {
    if (state.dailyBest) return state.dailyBest;
    return state.best;
  }

  function proofExport(proof) {
    if (!proof) return '';
    return JSON.stringify({
      proofId: proof.proofId || state.loadedProofId || undefined,
      version: proof.version,
      siteId: proof.siteId,
      challengeId: proof.challengeId,
      challengeName: state.challenge && proof.challengeId === state.challenge.challengeId ? state.challenge.challengeName : proof.challengeName,
      commitment: state.challenge && proof.challengeId === state.challenge.challengeId ? state.challenge.commitment : proof.commitment,
      salt: proof.salt,
      playerId: proof.playerId,
      token: proof.token,
      seedHex: proof.seedHex,
      nonce: proof.nonce,
      hash: proof.hash,
      leadingZeroBits: proof.leadingZeroBits,
      leadingHexZeroes: proof.leadingHexZeroes,
      gloryPoints: gloryForProof(proof),
      gloryScore: formatGlory(gloryForProof(proof)),
      gloryTier: gloryTier(proof.leadingZeroBits).title,
      minedAt: proof.minedAt,
    }, null, 2);
  }


  function shortHash(hash, size = 12) {
    if (!hash) return 'none';
    return `${String(hash).slice(0, size)}…`;
  }

  function updateProofInspector(proof) {
    if (!els.proofInspector) return;
    let parsed = proof || null;
    if (!parsed && els.proofBox && els.proofBox.value.trim()) {
      try { parsed = JSON.parse(els.proofBox.value); } catch { parsed = null; }
    }
    if (!parsed || !parsed.hash) {
      els.proofInspector.innerHTML = '<strong>Proof inspector</strong><span>No proof loaded yet.</span>';
      return;
    }
    const bits = Number(parsed.leadingZeroBits || 0);
    const commit = state.challenge && state.challenge.commitment ? state.challenge.commitment : parsed.commitment;
    const secretLine = parsed.redacted
      ? `Public receipt v${escapeHtml(String(parsed.receiptVersion || '?'))}: token, seed, nonce, player ID and server-only metadata are hidden.`
      : `Full local proof available in this browser before submission.`;
    els.proofInspector.innerHTML = `
      <strong>${escapeHtml(parsed.challengeId || 'unknown challenge')} · ${bits} zero bits</strong>
      <span>Hash <code>${escapeHtml(shortHash(parsed.hash, 18))}</code></span>
      <span>${secretLine}</span>
      <span>Commitment <code>${escapeHtml(shortHash(commit || 'not supplied', 18))}</code></span>
    `;
  }

  function updateFreshness() {
    if (state.proofPinned && els.proofBox.value.trim()) {
      els.proofFreshness.textContent = 'pasted proof';
      els.proofFreshness.className = 'badge';
      return;
    }
    const proof = currentProofForBox();
    if (!proof) {
      els.proofFreshness.textContent = 'no proof';
      els.proofFreshness.className = 'badge muted';
      return;
    }
    if (isCurrentProof(proof)) {
      els.proofFreshness.textContent = 'today';
      els.proofFreshness.className = 'badge';
    } else {
      els.proofFreshness.textContent = 'old proof';
      els.proofFreshness.className = 'badge muted';
    }
  }

  function updateMeter(bits) {
    const safeBits = Math.max(0, Number(bits || 0));
    const pct = Math.max(0, Math.min(100, (safeBits / LOTTO_BEAT_BITS) * 100));
    els.heroMeter.style.width = `${pct}%`;
    els.heroMeterText.textContent = safeBits >= LOTTO_BEAT_BITS
      ? `${safeBits} bits. UK Lotto odds beaten.`
      : `${safeBits}/${LOTTO_BEAT_BITS} zero bits towards the UK Lotto-odds target.`;
  }

  function updateLatest(candidate) {
    const c = candidate || state.latest;
    if (!c) {
      els.latestBits.textContent = '0 zero bits';
      els.latestOdds.textContent = '1 in 1';
      els.latestVerdict.textContent = 'Ready for a spin.';
      if (els.latestGlory) els.latestGlory.textContent = '0 GS';
      if (els.latestTier) els.latestTier.textContent = 'No tier yet';
      if (els.resultExplain) els.resultExplain.innerHTML = '<strong>What just happened?</strong><span>Spin once to roll one hash. The page will count its starting zeroes and show the odds.</span>';
      return;
    }
    els.latestBits.textContent = `${c.leadingZeroBits} zero bits`;
    els.latestOdds.textContent = oddsText(c.leadingZeroBits);
    els.latestVerdict.textContent = comparisonText(c.leadingZeroBits);
    if (els.resultExplain) {
      const tier = gloryTier(c.leadingZeroBits);
      const hashStart = shortHash(c.hash || '', 16);
      els.resultExplain.innerHTML = `<strong>You rolled ${escapeHtml(hashStart)}</strong><span>That starts with ${c.leadingZeroBits} zero bits. That is ${escapeHtml(oddsText(c.leadingZeroBits))}. Result: ${escapeHtml(tier.title)}.</span>`;
    }
    if (els.latestGlory) els.latestGlory.textContent = formatGlory(gloryForProof(c));
    if (els.latestTier) {
      const tier = gloryTier(c.leadingZeroBits);
      els.latestTier.textContent = `${tier.title} · ${tier.note}`;
    }
  }

  function updateGloryPanel(best) {
    if (els.proofPoints) els.proofPoints.textContent = best ? formatGlory(gloryForProof(best)) : '0 GS';
    if (els.proofTier) els.proofTier.textContent = best ? gloryTier(best.leadingZeroBits).title : 'No tier';
    if (els.gloryVault) els.gloryVault.textContent = formatGlory(state.glory);
    if (els.gloryVaultBig) els.gloryVaultBig.textContent = formatGlory(state.glory);
    if (els.gloryRank) els.gloryRank.textContent = gloryRank(state.glory).title;
    if (els.gloryRankSmall) els.gloryRankSmall.textContent = gloryRank(state.glory).title;
    if (els.nextGloryRank) {
      const next = nextGloryRank(state.glory);
      els.nextGloryRank.textContent = next
        ? `${formatGlory(next.min - state.glory)} until ${next.title}`
        : 'Max local rank reached.';
    }
    if (els.gloryFormula) els.gloryFormula.textContent = 'Score goes up with rarity. More starting zeroes means more points.';
    renderGloryEvents();
    renderAchievements();
    renderCabinetUpgrades();
    updateBountyPanel();
  }

  function renderGloryEvents() {
    if (!els.gloryEvents) return;
    const rows = state.gloryEvents.slice(0, 5);
    if (!rows.length) {
      els.gloryEvents.innerHTML = '<li><b>empty</b><span>No local score awarded yet. Find a new personal best.</span></li>';
      return;
    }
    els.gloryEvents.innerHTML = rows.map(row => `<li><b>+${escapeHtml(formatGlory(row.points))}</b><span>${escapeHtml(row.tier)} · ${escapeHtml(row.bits)} bits<br><code>${escapeHtml(String(row.hash).slice(0, 16))}…</code></span></li>`).join('');
  }

  function achievementUnlocked(item) {
    try { return Boolean(item.unlocked()); }
    catch { return false; }
  }

  function toastAchievement(item) {
    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML = `<b>Achievement unlocked</b><span>${escapeHtml(item.title)}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 260);
    }, 2600);
  }

  function currentCabinetGrade() {
    const unlocked = CABINET_UPGRADES.filter(item => achievementUnlocked(item)).length;
    if ((state.best?.leadingZeroBits || 0) >= LOTTO_BEAT_BITS) return 'Jackpot Glass';
    if (unlocked >= 5) return 'Gold cabinet';
    if (unlocked >= 3) return 'Warm cabinet';
    if (state.attempts > 0) return 'Lit cabinet';
    return 'Starter';
  }

  function renderCabinetUpgrades() {
    if (els.jackpotGrade) els.jackpotGrade.textContent = currentCabinetGrade();
    if (!els.upgradeGrid) return;
    els.upgradeGrid.innerHTML = CABINET_UPGRADES.map(item => {
      const unlocked = achievementUnlocked(item);
      return `<div class="upgrade ${unlocked ? 'unlocked' : ''}"><strong>${unlocked ? '✓' : '○'} ${escapeHtml(item.title)}</strong><span>${escapeHtml(item.requirement)}</span></div>`;
    }).join('');
  }

  function renderAchievements() {
    if (!els.achievements) return;
    const states = ACHIEVEMENTS.map(item => ({ item, unlocked: achievementUnlocked(item) }));
    const unlocked = states.filter(row => row.unlocked);

    if (els.achievementCount) {
      els.achievementCount.textContent = `${unlocked.length}/${ACHIEVEMENTS.length}`;
      els.achievementCount.className = unlocked.length === ACHIEVEMENTS.length ? 'badge' : 'badge muted';
    }

    if (!state.achievementsBooted) {
      state.seenAchievements = unlocked.map(row => row.item.id);
      saveJson('hj_seen_achievements', state.seenAchievements);
      state.achievementsBooted = true;
    } else {
      const fresh = unlocked.filter(row => !state.seenAchievements.includes(row.item.id));
      fresh.forEach(row => toastAchievement(row.item));
      if (fresh.length) {
        state.seenAchievements = [...new Set([...state.seenAchievements, ...fresh.map(row => row.item.id)])].slice(-120);
        saveJson('hj_seen_achievements', state.seenAchievements);
      }
    }

    els.achievements.innerHTML = states.map(({ item, unlocked }) => {
      return `<li class="${unlocked ? 'unlocked' : ''}"><b>${unlocked ? '✓' : '○'} ${escapeHtml(item.title)}</b><span>${escapeHtml(item.note)}</span></li>`;
    }).join('');
  }

  async function refreshServerStats() {
    if (!els.serverStats || !state.apiOk) return;
    try {
      const json = await fetchJson('api/stats');
      const stats = json.stats || {};
      els.serverStats.innerHTML = `
        <div><strong>${formatInt(stats.dailyProofs || 0)}</strong><span>today</span></div>
        <div><strong>${formatInt(stats.totalProofs || 0)}</strong><span>all-time proofs</span></div>
        <div><strong>${formatInt(stats.totalHashesTried || 0)}</strong><span>hashes tried</span></div>
        <div><strong>${stats.topDailyBits || 0}b</strong><span>daily top</span></div>
        <div><strong>${stats.topAllTimeBits || 0}b</strong><span>all-time top</span></div>
        <div><strong>${escapeHtml(compactTimeAgo(stats.lastSubmittedAt))}</strong><span>last public hit</span></div>
      `;
    } catch {
      els.serverStats.innerHTML = '<div><strong>offline</strong><span>stats unavailable</span></div>';
    }
  }


  async function refreshAudit() {
    if (!els.auditPanel) return;
    if (!state.apiOk) {
      els.auditPanel.innerHTML = '<div><strong>offline</strong><span>Audit endpoint unavailable in local demo mode.</span></div>';
      return;
    }
    try {
      const json = await fetchJson('api/audit');
      const audit = json.audit || {};
      const challenge = audit.challenge || {};
      els.auditPanel.innerHTML = `
        <div><strong>${escapeHtml(audit.appVersion || 'v?')}</strong><span>app build</span></div>
        <div><strong>${escapeHtml(String(audit.protocolVersion || 'v1'))}</strong><span>proof protocol</span></div>
        <div><strong>${escapeHtml(String(audit.minSubmitBits || 0))}+ bits</strong><span>leaderboard floor</span></div>
        <div><strong>${escapeHtml(String(audit.tokenTtlHours || '?'))}h</strong><span>token life</span></div>
        <div><strong>v${escapeHtml(String(audit.publicReceiptVersion || '?'))}</strong><span>public receipts</span></div>
        <div><strong>${audit.moderationEnabled ? 'enabled' : 'off'}</strong><span>moderation</span></div>
        <div><strong>${audit.trustProxy ? 'proxy' : 'socket'}</strong><span>IP source</span></div>
        <div><strong>${escapeHtml(shortHash(challenge.commitment || '', 14))}</strong><span>daily commitment</span></div>
        <div><strong>${escapeHtml(String(audit.rules && audit.rules.scoreSource || 'server'))}</strong><span>score source</span></div>
      `;
    } catch (err) {
      els.auditPanel.innerHTML = `<div><strong>error</strong><span>${escapeHtml(err.message)}</span></div>`;
    }
  }



  async function refreshLaunchStatus() {
    if (!els.launchStatus) return;
    if (!state.apiOk) {
      els.launchStatus.innerHTML = '<div><strong>offline</strong><span>API not mounted yet</span></div><div><strong>local only</strong><span>spins still work</span></div>';
      return;
    }
    try {
      const json = await fetchJson('api/status');
      const status = json.status || {};
      const storage = status.storage || {};
      const env = status.environment || {};
      const rules = status.rules || {};
      els.launchStatus.innerHTML = `
        <div><strong>${status.ready ? 'ready' : 'check'}</strong><span>deployment</span></div>
        <div><strong>${storage.dataDirWritable ? 'writable' : 'locked'}</strong><span>data folder</span></div>
        <div><strong>${storage.submissionsWritable ? 'writable' : 'locked'}</strong><span>submissions file</span></div>
        <div><strong>${escapeHtml(String(env.secretSource || 'unknown'))}</strong><span>secret source</span></div>
        <div><strong>${env.adminEnabled ? 'enabled' : 'off'}</strong><span>admin tools</span></div>
        <div><strong>${escapeHtml(String(rules.minSubmitBits || 0))}+ bits</strong><span>submit floor</span></div>
        <div><strong>${formatInt(storage.visibleProofs || 0)}</strong><span>visible proofs</span></div>
        <div><strong>${formatInt(status.uptimeSeconds || 0)}s</strong><span>api uptime</span></div>
      `;
    } catch (err) {
      els.launchStatus.innerHTML = `<div><strong>error</strong><span>${escapeHtml(err.message)}</span></div>`;
    }
  }

  function nextTargetBits() {
    const best = Number(state.best?.leadingZeroBits || 0);
    const targets = [8, 12, 16, Number(state.challenge?.minSubmitBits || 20), Number(state.dailyBountyBits || 0), LOTTO_BEAT_BITS, 28, 32, 36, 40]
      .filter(n => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    return targets.find(n => n > best) || 40;
  }

  function renderCabinetStrip() {
    const target = nextTargetBits();
    const hot = state.recent.filter(r => Number(r.leadingZeroBits || 0) >= 8).length;
    const boardText = state.apiOk ? 'online' : 'local mode';
    if (els.nextTarget) els.nextTarget.textContent = `${target} bits`;
    if (els.sessionPeak) els.sessionPeak.textContent = `${state.sessionPeak || 0} bits`;
    if (els.hotPulls) els.hotPulls.textContent = String(hot);
    if (els.tickerBoard) els.tickerBoard.textContent = boardText;
    if (els.tickerFloor) els.tickerFloor.textContent = state.challenge ? `${state.challenge.minSubmitBits}+ bits` : 'loading';
    if (els.tickerTarget) els.tickerTarget.textContent = `${target} bits`;
    updateBoardStatusTile();
  }

  function updateStats(sampleHash) {
    const best = state.best;
    const daily = state.dailyBest;
    els.hashesTried.textContent = formatInt(state.attempts);
    els.todayBest.textContent = daily ? `${daily.leadingZeroBits} bits` : '0 bits';

    if (!best) {
      els.bestHash.textContent = 'No proof yet. Spin first.';
      els.bestBits.textContent = '0 bits';
      els.bestHex.textContent = '0';
      els.bestOdds.textContent = '1 in 1';
      updateGloryPanel(null);
      els.verdict.textContent = 'Start spinning. Rare pulls will appear here.';
      if (!state.proofPinned) els.proofBox.value = '';
      updateProofInspector(null);
      updateFreshness();
      updateMeter(0);
      updateLatest();
      updateReels(sampleHash || '');
      renderRecent();
      updateSubmitReadiness();
      renderCabinetStrip();
      return;
    }

    els.bestHash.textContent = best.hash;
    els.bestBits.textContent = `${best.leadingZeroBits} bits`;
    els.bestHex.textContent = String(best.leadingHexZeroes);
    els.bestOdds.textContent = oddsText(best.leadingZeroBits);
    updateGloryPanel(best);
    els.verdict.textContent = comparisonText(best.leadingZeroBits);
    if (!state.proofPinned) els.proofBox.value = proofExport(currentProofForBox());
    updateProofInspector(currentProofForBox());
    updateFreshness();
    updateMeter(best.leadingZeroBits);
    updateLatest();
    updateReels(sampleHash || best.hash);
    renderRecent();
    updateSubmitReadiness();
    renderCabinetStrip();
  }

  function renderLadder() {
    els.ladder.innerHTML = LOTTO_TIERS.map(t => {
      const bits = Math.ceil(Math.log2(t.odds));
      return `<div class="ladder-row">
        <span>${escapeHtml(t.label)}</span>
        <strong>~${bits} bits</strong>
        <em>1 in ${formatInt(t.odds)}</em>
      </div>`;
    }).join('') + `<div class="ladder-row boss"><span>Clean 7 hex zeroes</span><strong>28 bits</strong><em>1 in ${formatInt(268435456)}</em></div>`;
  }

  function renderRecent() {
    const rows = state.recent.slice(0, 6);
    if (!rows.length) {
      els.recentPulls.innerHTML = '<li><b>idle</b><span>No spins yet.</span></li>';
      return;
    }
    els.recentPulls.innerHTML = rows.map(row => `<li><b>${row.leadingZeroBits}b</b><span><code>${escapeHtml(row.hash.slice(0, 18))}…</code><br>${escapeHtml(oddsText(row.leadingZeroBits))} · ${escapeHtml(gloryLine(row))}</span></li>`).join('');
  }

  function rememberRecent(candidate) {
    state.recent.unshift({ hash: candidate.hash, leadingZeroBits: candidate.leadingZeroBits, leadingHexZeroes: candidate.leadingHexZeroes, minedAt: candidate.minedAt });
    state.recent = state.recent.slice(0, 12);
    saveJson('hj_recent', state.recent);
  }

  async function fetchJson(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const opts = { ...(options || {}), signal: options && options.signal ? options.signal : controller.signal };
    try {
      const res = await fetch(url, opts);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const route = typeof url === 'string' ? url : 'API';
        const mounted = String(route).startsWith('api/');
        const hint = mounted && (res.status === 404 || res.status === 502 || res.status === 503)
          ? ' Public leaderboard route is not mounted yet.'
          : '';
        throw new Error((json.error || `HTTP ${res.status}`) + hint);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  function setAttemptCounterForChallenge(challenge) {
    const challengeId = challenge && challenge.challengeId ? String(challenge.challengeId) : 'offline';
    state.attemptKey = `hj_attempts_${challengeId}`;
    state.attempts = Number(localStorage.getItem(state.attemptKey) || 0);
    if (!Number.isFinite(state.attempts) || state.attempts < 0) state.attempts = 0;
  }

  async function loadChallenge() {
    try {
      const json = await fetchJson(`api/challenge?playerId=${encodeURIComponent(state.playerId)}`);
      state.apiOk = true;
      state.challenge = json.challenge;
      setAttemptCounterForChallenge(state.challenge);
      state.token = json.token;
      state.dailyBest = loadJson(todayKey(state.challenge.challengeId));
      els.apiNotice.textContent = 'Leaderboard online. Scores can be checked.';
      updateBoardStatusTile();
      els.challenge.textContent = json.challenge.challengeId;
      if (els.challengeName) els.challengeName.textContent = json.challenge.challengeName || 'Daily proof run';
      els.salt.textContent = json.challenge.salt.slice(0, 18) + '…';
      if (els.commitment) els.commitment.textContent = 'commit ' + String(json.challenge.commitment || '').slice(0, 14) + '…';
      els.minSubmitBits.textContent = `${json.challenge.minSubmitBits}+ bits`;
      state.dailyBountyBits = dailyBountyFromChallenge(state.challenge);
      updateBountyPanel();
      updateTargetHint();
      updateCountdown();
      clearInterval(state.countdownTimer);
      state.countdownTimer = setInterval(updateCountdown, 1000);
      setStatus('Ready. Press Spin once, or use Auto spin for a steady run.');
      updateSubmitReadiness();
    } catch (err) {
      state.apiOk = false;
      state.challenge = {
        version: 'hashjackpot:v1',
        siteId: 'nathm.net/hashjackpot-offline',
        challengeId: new Date().toISOString().slice(0, 10),
        salt: 'offline-demo-salt-no-leaderboard',
        minSubmitBits: 20,
        lottoJackpotBeatBits: LOTTO_BEAT_BITS,
      };
      setAttemptCounterForChallenge(state.challenge);
      state.token = 'offline-token';
      state.dailyBest = loadJson(todayKey(state.challenge.challengeId));
      els.apiNotice.textContent = 'Offline mode. Spins still work here, but public scores cannot be posted yet.';
      updateBoardStatusTile();
      els.challenge.textContent = state.challenge.challengeId + ' offline';
      if (els.challengeName) els.challengeName.textContent = 'Offline Demo';
      els.salt.textContent = 'offline';
      if (els.commitment) els.commitment.textContent = 'no public commitment';
      els.minSubmitBits.textContent = `${state.challenge.minSubmitBits}+ bits`;
      state.dailyBountyBits = dailyBountyFromChallenge(state.challenge);
      updateBountyPanel();
      updateTargetHint();
      updateCountdown();
      clearInterval(state.countdownTimer);
      state.countdownTimer = setInterval(updateCountdown, 1000);
      setStatus('Offline mode is active. Spins work here, but the public leaderboard is not connected.');
      updateSubmitReadiness();
    }
  }

  function maybeUpdateBest(candidate) {
    let improved = false;
    if (betterScore(candidate, state.best)) {
      state.best = candidate;
      saveJson('hj_best', candidate);
      improved = true;
    }
    if (isCurrentProof(candidate) && betterScore(candidate, state.dailyBest)) {
      state.dailyBest = candidate;
      saveJson(todayKey(candidate.challengeId), candidate);
      improved = true;
    }
    if (improved) {
      awardGlory(candidate);
      state.proofPinned = false;
      els.submit.classList.add('pulse');
      setTimeout(() => els.submit.classList.remove('pulse'), 600);
    }
    return improved;
  }

  function oneSpin(options = {}) {
    if (!state.challenge || !state.token) return null;
    const auto = options.auto === true;
    const now = Date.now();
    if (!auto && now < state.nextAllowedSpinAt) {
      const wait = Math.ceil((state.nextAllowedSpinAt - now) / 1000);
      setStatus(`Give it ${wait}s. One spin means one visible hash.`);
      return null;
    }
    state.nextAllowedSpinAt = now + SPIN_COOLDOWN_MS;
    const seedHex = randHex(32);
    const nonce = String(crypto.getRandomValues(new Uint32Array(1))[0]);
    const candidate = makeCandidate(seedHex, nonce);
    state.latest = candidate;
    state.sessionPeak = Math.max(state.sessionPeak || 0, Number(candidate.leadingZeroBits || 0));
    state.attempts += 1;
    localStorage.setItem(state.attemptKey || 'hj_attempts', String(state.attempts));
    const improved = maybeUpdateBest(candidate);
    rememberRecent(candidate);
    if (auto) {
      const elapsed = Math.max(1, (Date.now() - state.autoStartedAt) / 1000);
      const autoPulls = Math.max(0, state.attempts - state.turboBaseline);
      state.hashRate = autoPulls / elapsed;
      els.speed.textContent = `${formatInt(state.hashRate * 60)} spins/min`;
      if (improved || candidate.leadingZeroBits >= 12) {
        setStatus(`${candidate.leadingZeroBits} zero bits found. Auto spin keeps going until the target or Stop.`);
      }
    } else {
      state.hashRate = 0;
      els.speed.textContent = 'single spin';
      setStatus(candidate.leadingZeroBits >= LOTTO_BEAT_BITS ? 'UK Lotto odds beaten. Rare hash found.' : 'Spin complete. Rarity checked.');
    }
    updateStats(candidate.hash);
    return candidate;
  }

  function startTurbo() {
    if (state.mining || !state.challenge || !state.token) return;
    state.mining = true;
    state.turboBaseline = state.attempts;
    state.autoStartedAt = Date.now();
    state.hashRate = 0;
    els.turbo.disabled = true;
    els.stop.disabled = false;
    els.pull.disabled = true;
    updateReels('', true);
    setStatus('Auto spin is running: one visible hash every 1.6 seconds. No hidden hash farming.');

    const target = targetBitsForSelection();
    const runAutoSpin = () => {
      if (!state.mining) return;
      const candidate = oneSpin({ auto: true });
      if (candidate && target && candidate.leadingZeroBits >= target) {
        setStatus(`Target hit: ${candidate.leadingZeroBits} zero bits. Auto spin stopped.`);
        stopTurbo();
      }
    };

    runAutoSpin();
    state.autoTimer = setInterval(runAutoSpin, AUTO_SPIN_INTERVAL_MS);
  }

  function stopTurbo() {
    if (!state.mining) return;
    if (state.autoTimer) {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
    finishTurbo(0, null);
  }

  function finishTurbo(workerAttempts, workerBest) {
    clearTimeout(state.stopTimer);
    if (state.autoTimer) {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
    if (workerBest) {
      state.latest = workerBest;
      state.sessionPeak = Math.max(state.sessionPeak || 0, Number(workerBest.leadingZeroBits || 0));
      maybeUpdateBest(workerBest);
      rememberRecent(workerBest);
    }
    if (Number(workerAttempts || 0) > 0) {
      state.attempts = Math.max(state.attempts, state.turboBaseline + Number(workerAttempts || 0));
      localStorage.setItem(state.attemptKey || 'hj_attempts', String(state.attempts));
    }
    state.mining = false;
    els.turbo.disabled = false;
    els.stop.disabled = true;
    els.pull.disabled = false;
    state.hashRate = 0;
    els.speed.textContent = 'idle';
    if (state.worker) {
      try { state.worker.terminate(); } catch {}
      state.worker = null;
    }
    setStatus("Auto spin stopped. Your best result is saved in this browser.");
    renderAchievements();
    renderCabinetUpgrades();
    updateStats();
  }

  async function submitBest() {
    els.submitResult.textContent = '';
    if (!state.apiOk) {
      els.submitResult.textContent = 'The public leaderboard is not online yet. You can still spin locally.';
      return;
    }
    if (!state.dailyBest) {
      els.submitResult.textContent = 'No leaderboard-ready result for today yet. Spin once or use Auto spin.';
      return;
    }
    if (state.dailyBest.leadingZeroBits < state.challenge.minSubmitBits) {
      els.submitResult.textContent = `Valid locally, but not rare enough for the leaderboard. Need ${state.challenge.minSubmitBits}+ starting zero bits.`;
      return;
    }
    const displayName = (els.playerName.value || '').trim() || 'anonymous player';
    localStorage.setItem('hj_display_name', displayName);

    try {
      const json = await fetchJson('api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          playerId: state.dailyBest.playerId,
          challengeId: state.dailyBest.challengeId,
          token: state.dailyBest.token,
          seedHex: state.dailyBest.seedHex,
          nonce: state.dailyBest.nonce,
          hashesTried: state.attempts,
        }),
      });
      els.submitResult.textContent = json.message || json.error || 'Submitted.';
      if (json.ok && json.submission && json.submission.proofId) {
        state.loadedProofId = json.submission.proofId;
        const publicProof = json.publicProof || null;
        if (publicProof) {
          els.proofBox.value = JSON.stringify(publicProof, null, 2);
          updateProofInspector(publicProof);
          state.proofPinned = true;
          els.proofFreshness.textContent = 'public receipt';
          els.proofFreshness.className = 'badge';
        } else {
          try {
            const parsed = JSON.parse(els.proofBox.value || '{}');
            parsed.proofId = json.submission.proofId;
            parsed.displayName = json.submission.displayName || displayName;
            els.proofBox.value = JSON.stringify(parsed, null, 2);
            updateProofInspector(parsed);
            state.proofPinned = true;
          } catch {}
        }
      }
      await refreshLeaderboard();
      await refreshServerStats();
      await refreshAudit();
      await refreshLaunchStatus();
    } catch (err) {
      els.submitResult.textContent = err.message;
    }
  }

  function renderLeaderboardFlex(rows) {
    if (!els.leaderboardFlex) return;
    const top = (rows || []).slice(0, 3);
    if (!top.length) {
      els.leaderboardFlex.innerHTML = '<div class="proof-card muted"><span>No public scores yet</span><strong>First place is open</strong><em>Roll a leaderboard-ready hash and submit it.</em></div>';
      return;
    }
    els.leaderboardFlex.innerHTML = top.map((row, idx) => {
      const rankLabel = state.leaderboardScope === 'attempts' ? (idx === 0 ? 'Most hashes tried' : `#${row.rank}`) : (idx === 0 ? 'Top pull' : `#${row.rank}`);
      const attemptLine = Number(row.hashesTried || 0) > 0 ? ` · ${formatInt(Number(row.hashesTried || 0))} tried` : '';
      return `<div class="proof-card ${idx === 0 ? 'champion' : ''}">
        <span>${escapeHtml(rankLabel)}</span>
        <strong>${escapeHtml(row.leadingZeroBits)} zero bits</strong>
        <em class="odds-line">${escapeHtml(row.odds)}</em>
        <small>${escapeHtml(row.displayName)}${attemptLine} · <code>${escapeHtml(row.shortHash)}</code></small>
        <button class="mini table-action" data-proof-id="${escapeHtml(row.proofId || '')}">Open proof</button>
      </div>`;
    }).join('');
  }

  async function refreshLeaderboard() {
    if (!state.apiOk) {
      els.leaderboardBody.innerHTML = '';
      els.leaderboardEmpty.hidden = false;
      els.leaderboardEmpty.textContent = 'The public leaderboard is still coming online.';
      if (els.leaderboardFlex) els.leaderboardFlex.innerHTML = '<div class="proof-card muted"><span>Leaderboard reconnecting</span><strong>Spins still work</strong><em>Scores appear here once the leaderboard is online.</em></div>';
      return;
    }
    try {
      const json = await fetchJson(`api/leaderboard?scope=${state.leaderboardScope}`);
      const rows = json.rows || [];
      els.leaderboardEmpty.hidden = rows.length > 0;
      renderLeaderboardFlex(rows);
      els.leaderboardBody.innerHTML = rows.map(row => `<tr>
        <td>#${row.rank}</td>
        <td>${escapeHtml(row.displayName)}</td>
        <td>${row.leadingZeroBits} bits<br><small>${row.leadingHexZeroes} hex zeroes</small></td>
        <td>${escapeHtml(row.gloryScore || formatGlory(gloryForProof(row)))}<br><small>${escapeHtml(row.gloryTier || gloryTier(row.leadingZeroBits).title)}</small></td>
        <td>${escapeHtml(row.odds)}</td>
        <td>${formatInt(Number(row.hashesTried || 0))}</td>
        <td><code title="${escapeHtml(row.hash)}">${escapeHtml(row.shortHash)}</code></td>
        <td><button class="table-action" data-proof-id="${escapeHtml(row.proofId || '')}">Proof</button></td>
      </tr>`).join('');
    } catch (err) {
      els.leaderboardEmpty.hidden = false;
      els.leaderboardEmpty.textContent = err.message;
    }
  }

  async function loadPublicProof(proofId) {
    if (!proofId || !state.apiOk) return;
    try {
      const json = await fetchJson(`api/proof?proofId=${encodeURIComponent(proofId)}`);
      els.proofBox.value = JSON.stringify(json.proof, null, 2);
      updateProofInspector(json.proof);
      state.proofPinned = true;
      state.loadedProofId = json.proof && json.proof.proofId ? json.proof.proofId : proofId;
      els.proofFreshness.textContent = 'public proof';
      els.proofFreshness.className = 'badge';
      setStatus('Public leaderboard proof loaded. You can verify the receipt now.');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function shareResult() {
    const proof = currentProofForBox();
    if (!proof) {
      setStatus('No result proof yet. Spin first.');
      return;
    }
    const link = publicProofLink();
    const text = [
      'HashJackpot result proof',
      `${proof.leadingZeroBits} starting zero bits`,
      `${oddsText(proof.leadingZeroBits)}`,
      `${gloryLine(proof)}`,
      link ? `Proof link: ${link}` : 'Submit the result to create a public proof link.'
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Result proof copied.');
    } catch {
      setStatus(text);
    }
  }

  async function verifyProof() {
    els.verifyResult.textContent = '';
    if (!state.apiOk) {
      els.verifyResult.textContent = 'Verifier API is offline. Public verification is not available yet.';
      return;
    }
    if (!els.proofBox.value.trim()) {
      els.verifyResult.textContent = 'No proof yet. Spin first.';
      return;
    }
    try {
      const proof = JSON.parse(els.proofBox.value);
      updateProofInspector(proof);
      const json = await fetchJson('api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof }),
      });
      const c = json.computed || {};
      els.verifyResult.textContent = `${json.message} ${c.leadingZeroBits} zero bits, ${c.odds}, ${c.gloryScore || formatGlory(gloryForProof(c))}, ${c.gloryTier || gloryTier(c.leadingZeroBits).title}.`;
    } catch (err) {
      els.verifyResult.textContent = err.message;
    }
  }

  function publicProofLink() {
    let proofId = state.loadedProofId;
    try {
      const parsed = JSON.parse(els.proofBox.value || '{}');
      if (parsed.proofId) proofId = parsed.proofId;
    } catch {}
    if (!proofId) return '';
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?proof=${encodeURIComponent(proofId)}`;
  }

  async function copyProofLink() {
    const link = publicProofLink();
    if (!link) {
      setStatus('No public proof link yet. Submit a rare enough proof first, or open one from the leaderboard.');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Proof link copied. Anyone can open it and check the receipt.');
    } catch {
      setStatus(link);
    }
  }

  async function copyProof() {
    const text = els.proofBox.value.trim();
    if (!text) {
      setStatus('No proof to copy yet. Spin first.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Proof copied.');
    } catch {
      els.proofBox.select();
      setStatus('Clipboard blocked. Proof text selected instead.');
    }
  }


  async function copyExplainer() {
    const text = 'HashJackpot is a rare-hash leaderboard. Press Spin and the page rolls one SHA-256 hash. If it starts with zeroes, it scores. More zeroes means longer odds and a better rank on the public leaderboard.';
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Simple explanation copied.');
    } catch {
      setStatus(text);
    }
  }


  async function copyText(text, success) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(success);
    } catch {
      setStatus(text);
    }
  }

  async function copyMathExplain() {
    const text = 'Each spin makes one SHA-256 hash. A hash with 8 starting zero bits is about 1 in 256. 16 bits is about 1 in 65,536. 20 bits is about 1 in 1,048,576. 26 bits is rarer than the UK National Lottery Lotto jackpot odds of 1 in 45,057,474. The leaderboard ranks the rarest verified results.';
    await copyText(text, 'Maths explainer copied.');
  }


  async function copyPageLink() {
    const link = `${window.location.origin}${window.location.pathname}`;
    await copyText(link, 'Page link copied.');
  }

  async function retryApi() {
    setStatus('Checking the public leaderboard again...');
    await loadChallenge();
    await refreshLeaderboard();
    await refreshServerStats();
    updateStats();
  }

  function isTypingTarget(target) {
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);
  }

  function bindKeyboardShortcuts() {
    window.addEventListener('keydown', (event) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (!state.mining) oneSpin();
      } else if (event.key && event.key.toLowerCase() === 't') {
        event.preventDefault();
        if (state.mining) stopTurbo(); else startTurbo();
      } else if (event.key === 'Escape') {
        if (state.mining) stopTurbo();
      } else if (event.key && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        verifyProof();
      }
    });
  }

  function resetLocal() {
    if (state.mining) stopTurbo();
    if (!confirm('Reset local HashJackpot stats on this browser? Public leaderboard entries stay online.')) return;
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('hj_') && key !== 'hj_player_id') localStorage.removeItem(key);
    });
    localStorage.setItem('hj_schema_version', STORAGE_SCHEMA_VERSION);
    state.best = null;
    state.dailyBest = state.challenge ? loadJson(todayKey(state.challenge.challengeId)) : null;
    state.recent = [];
    state.glory = 0;
    state.gloryEvents = [];
    state.awardedHashes = [];
    state.seenAchievements = [];
    state.achievementsBooted = false;
    state.proofPinned = false;
    state.attempts = 0;
    if (state.attemptKey) localStorage.setItem(state.attemptKey, '0');
    state.latest = null;
    els.speed.textContent = 'idle';
    updateStats();
    setStatus('Local stats reset. Public leaderboard entries stay online.');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch]));
  }

  function setLeaderboardScope(scope) {
    state.leaderboardScope = scope;
    if (els.scopeDaily) els.scopeDaily.classList.toggle('active', scope === 'daily');
    if (els.scopeAll) els.scopeAll.classList.toggle('active', scope === 'alltime');
    if (els.scopeRecent) els.scopeRecent.classList.toggle('active', scope === 'recent');
    if (els.scopeAttempts) els.scopeAttempts.classList.toggle('active', scope === 'attempts');
    refreshLeaderboard();
  }

  function bindEvents() {
    els.pull.addEventListener('click', oneSpin);
    els.turbo.addEventListener('click', startTurbo);
    els.stop.addEventListener('click', stopTurbo);
    els.submit.addEventListener('click', submitBest);
    els.verifyProof.addEventListener('click', verifyProof);
    els.copyProof.addEventListener('click', copyProof);
    if (els.copyProofLink) els.copyProofLink.addEventListener('click', copyProofLink);
    els.shareResult.addEventListener('click', shareResult);
    els.resetLocal.addEventListener('click', resetLocal);
    els.turboTarget.addEventListener('change', updateTargetHint);
    if (els.copyExplainer) els.copyExplainer.addEventListener('click', copyExplainer);
    if (els.copyMathExplain) els.copyMathExplain.addEventListener('click', copyMathExplain);
    if (els.copyBoardLink) els.copyBoardLink.addEventListener('click', copyPageLink);
    if (els.copyResultProof) els.copyResultProof.addEventListener('click', shareResult);
    if (els.retryApi) els.retryApi.addEventListener('click', retryApi);
    els.proofBox.addEventListener('input', () => { state.proofPinned = true; updateProofInspector(); });
    const proofClick = (event) => {
      const btn = event.target.closest('[data-proof-id]');
      if (btn) loadPublicProof(btn.getAttribute('data-proof-id'));
    };
    els.leaderboardBody.addEventListener('click', proofClick);
    if (els.leaderboardFlex) els.leaderboardFlex.addEventListener('click', proofClick);
    els.refreshBoard.addEventListener('click', refreshLeaderboard);
    els.scopeDaily.addEventListener('click', () => setLeaderboardScope('daily'));
    els.scopeAll.addEventListener('click', () => setLeaderboardScope('alltime'));
    if (els.scopeRecent) els.scopeRecent.addEventListener('click', () => setLeaderboardScope('recent'));
    if (els.scopeAttempts) els.scopeAttempts.addEventListener('click', () => setLeaderboardScope('attempts'));
  }

  async function loadProofFromUrl() {
    const proofId = new URLSearchParams(window.location.search).get('proof');
    if (proofId && state.apiOk) await loadPublicProof(proofId);
  }

  async function init() {
    migrateLocalStorage();
    if (sessionStorage.getItem('hj_v111_reset_notice') === '1') {
      sessionStorage.removeItem('hj_v111_reset_notice');
      setTimeout(() => setStatus('Fresh v111 table loaded. Old local test spins were cleared.'), 400);
    }
    els.playerName.value = localStorage.getItem('hj_display_name') || '';
    renderLadder();
    renderCabinetUpgrades();
    bindEvents();
    bindKeyboardShortcuts();
    updateStats();
    await loadChallenge();
    await refreshLeaderboard();
    await refreshServerStats();
    await refreshAudit();
    await refreshLaunchStatus();
    await loadProofFromUrl();
    updateStats();
  }

  init();
})();
