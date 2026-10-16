# Chog Stack

**One shared tower, built live on Monad from all 1,969 Chog Genesis NFTs.**

Every Chog's traits forge its own physics block. Holders get one drop per Chog per day: time the crane, drop,
and try to be the Chog on top when the tower comes down. Whoever knocks it over goes on the wall of shame.

Built for Chogathon 2026.

## Why the NFT is the game

Take the NFT out and there is nothing left to stack:

- **Traits become physics.** The `Head` trait picks the top shape: caps stick a brim out on the side the Chog
  faces (`Side`), bucket hats make a wide deck, crowns, horns and wizard hats make a spike nothing sits on
  comfortably, headbands give a flat top, and bare heads get two ears. `Accessory` adds a side nub, `Aura`
  sets the material (Burning bounces, Smoke slides, other auras are heavy and grippy), and `Tier` sets size
  and weight (Legendaries are big). The real Chog art fills the block.
- **Ownership is the turn.** Only a wallet holding a Chog can drop it, checked against `ownerOf` on Monad at
  drop time. More Chogs means more drops per day.
- **The record lives with the token.** Season crowns, midnight daily crowns, clean landings, misses,
  knock-offs and topples are stored per token ID, so a Chog's career follows it to its next owner.

## How a season works

- One tower for everyone, simulated on the server (matter.js). The server records the frames and streams
  them to every viewer over SSE, so everyone watches the same drop.
- If a drop knocks 3+ Chogs off (or the tower loses 45% of its height), it **collapses**. The Chog that was on
  the summit takes the season crown, the dropper is shamed, and a fresh site opens.
- The Chog on top at 00:00 UTC gets a daily crown. Seasons also end after 7 days if the tower never falls.
- **$CHOG:** anyone can burn $CHOG (sent to `0x…dEaD`) to hit the live tower with a gust (500) or a quake
  (1,500). The server verifies the burn transaction on Monad before running it. Burns are counted on site.

For people without a Chog: **Arcade** (the Daily Stack — same Chog order for everyone that day, 3 lives, wind
past 8 m, score board) and **Practice** (a private copy of the live tower).

## Run it

```bash
npm install
npx vite build
node server/index.js        # http://localhost:8787
```

Environment: `PORT`, `DATA_DIR` (state + cached art), `SESSION_SECRET`, `PRICE_GUST`, `PRICE_QUAKE`,
`RPC_URLS`. For local testing without a wallet, put `{"0xaddr":[tokenIds]}` in `data/dev-owners.json`, run with
`NODE_ENV=development` and open `/?dev=0xaddr`.

## Stack

Vanilla JS + Canvas, matter.js (shared physics in `shared/physics.js`, used by server and browser), Express,
viem (Multicall3 owner index, signature sign-in, burn verification), sharp. Metadata and art were pulled from
the collection's IPFS folders (`scripts/fetch-all.mjs`); the server fetches anything missing on demand.

Contracts (Monad mainnet, chain 143): Chog Genesis `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`,
$CHOG `0x350035555e10d9afaf1566aaebfced5ba6c27777`.
