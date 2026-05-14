/* Small dependency-free SHA-256 helper shared by app.js and miner.worker.js. */
(function attachSha256(global) {
  'use strict';

  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);

  const H0 = new Uint32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
  ]);

  const encoder = new TextEncoder();
  const hex = [];
  for (let i = 0; i < 256; i++) hex[i] = i.toString(16).padStart(2, '0');

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Bytes(message) {
    const l = message.length;
    const bitLenHi = Math.floor((l * 8) / 0x100000000);
    const bitLenLo = (l * 8) >>> 0;
    const withOne = l + 1;
    const paddedLength = withOne + ((64 - ((withOne + 8) % 64)) % 64) + 8;
    const bytes = new Uint8Array(paddedLength);
    bytes.set(message);
    bytes[l] = 0x80;
    const view = new DataView(bytes.buffer);
    view.setUint32(paddedLength - 8, bitLenHi, false);
    view.setUint32(paddedLength - 4, bitLenLo, false);

    const H = new Uint32Array(H0);
    const W = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }

      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + temp1) >>> 0;
        d = c; c = b; b = a;
        a = (temp1 + temp2) >>> 0;
      }

      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }

    let out = '';
    for (let i = 0; i < H.length; i++) {
      out += hex[(H[i] >>> 24) & 255] + hex[(H[i] >>> 16) & 255] + hex[(H[i] >>> 8) & 255] + hex[H[i] & 255];
    }
    return out;
  }

  function sha256Hex(text) {
    return sha256Bytes(encoder.encode(text));
  }

  function countLeadingZeroBits(hash) {
    let count = 0;
    for (let i = 0; i < hash.length; i++) {
      const n = parseInt(hash[i], 16);
      if (n === 0) { count += 4; continue; }
      if (n < 2) return count + 3;
      if (n < 4) return count + 2;
      if (n < 8) return count + 1;
      return count;
    }
    return count;
  }

  function countLeadingHexZeroes(hash) {
    const m = /^0*/.exec(hash);
    return m ? m[0].length : 0;
  }

  global.HashJackpotCrypto = { sha256Hex, countLeadingZeroBits, countLeadingHexZeroes };
})(typeof self !== 'undefined' ? self : window);
