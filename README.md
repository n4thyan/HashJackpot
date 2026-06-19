# HashJackpot

HashJackpot is a SHA-256 probability demo and rare-hash leaderboard.

Each spin generates one SHA-256 hash. The more zero bits the hash starts with, the rarer the result. Good results can be submitted to a leaderboard, where the server recomputes the proof before accepting it.

## Project status

HashJackpot is currently a prototype and is not live on nathm.net while the portfolio site is being rebuilt.

The current version includes the core browser demo and a Node.js backend for challenge tokens, server-verified submissions, public proof receipts and leaderboard data.

Planned future work includes restoring the live demo, reviewing deployment/security settings, adding screenshots and deciding whether it should live at `/hashjackpot/` or a separate subdomain.

## Built with

- HTML
- CSS
- JavaScript
- Web Worker
- SHA-256 hashing
- Node.js backend
- No external runtime dependencies in the backend
- AI-assisted development with human review

## How it works

One spin creates one SHA-256 hash.

Hashes are shown in hexadecimal. Each hex character has 16 possible values, but the app scores by leading zero bits so it can compare results more precisely than whole hex characters.

Example odds:

- 8 leading zero bits: 1 in 256
- 12 leading zero bits: 1 in 4,096
- 16 leading zero bits: 1 in 65,536
- 20 leading zero bits: 1 in 1,048,576
- 26 leading zero bits: rarer than UK Lotto jackpot odds

## Server-side verification

The backend is designed so the browser is not trusted.

The server:

- issues signed challenge tokens
- recalculates submitted hashes from canonical proof fields
- rejects low-difficulty submissions before storage
- stores accepted submissions in JSON
- exposes public leaderboard and proof APIs
- redacts private proof fields from public receipts

## Why this is in my portfolio

HashJackpot is a creative technical demo showing practical work with browser JavaScript, hashing, probability, backend validation, proof-style receipts and leaderboard logic.

It is not a gambling product and does not involve real money, crypto or prizes.
