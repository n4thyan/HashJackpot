# nathm.net v114 HashJackpot launch candidate

This pass focuses on making HashJackpot clearer and more public-facing.

Main changes:
- Slower auto spin: one visible hash every 1.6 seconds.
- One spin equals one hash, with copy updated across the page.
- Public leaderboard entry lowered to 8 zero bits so the leaderboard can start filling.
- Old local HashJackpot counters are reset by the browser schema bump.
- Server data is reset once on deploy by a v114 marker.
- Added/kept the Most spins leaderboard, now using the current daily challenge.
- Reworked the text so non-technical users can understand it.
- Removed the public-facing "fake slot" wording and the heavy dev-style explanation.
- Backend version is 1.14.0.

Important route shape:
- /hashjackpot/ serves the public app.
- /hashjackpot/api/* proxies to the backend on 127.0.0.1:8791/api/*.
- This deploy script does not rewrite Nginx if the existing HashJackpot API route already works.

Sensitive files are not included:
- server_secret.txt
- submissions.json
- .env
