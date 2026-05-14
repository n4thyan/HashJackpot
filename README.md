# HashJackpot

HashJackpot is a SHA-256 luck game.

Each spin generates one hash. The more zeroes it starts with, the rarer the result. Good pulls can be submitted to a leaderboard.

Live version:

https://nathm.net/hashjackpot/

## Built with

- HTML
- CSS
- JavaScript
- Node.js backend
- ChatGPT-assisted development

## How it works

One spin creates one SHA-256 hash.

Hashes are shown in hexadecimal, where each character has 16 possible values. That means each leading zero makes a result 16 times rarer.

Example odds:

- 1 leading zero: 1 in 16
- 2 leading zeroes: 1 in 256
- 3 leading zeroes: 1 in 4,096
- 4 leading zeroes: 1 in 65,536
- 5 leading zeroes: 1 in 1,048,576

The public site includes odds, proof receipts and a global leaderboard.
