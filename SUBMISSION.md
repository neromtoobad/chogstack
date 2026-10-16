# Chogathon 2026 — submission draft

**01 · Project:** Chog Stack. Team: neromtoobad (solo). Discord: _fill in_. X: _fill in_.

**02 · What you built.**
One tower that every Chog holder builds together, live, on Monad. Each Chog drops from a swinging crane as a
physics block. Time the drop, land it, and try to be the Chog on top when the tower falls. If a drop knocks 3 or
more Chogs off, the tower collapses: the Chog on the summit wins the season crown, and the Chog that knocked it
down goes on the wall of shame. A new site opens and a new season starts. The Chog on top at 00:00 UTC takes a
daily crown, so people check back to defend the summit.

What's new: the NFT isn't a badge or a skin. Its traits are the shape of the piece.

**03 · Why Chog matters.**
Remove the NFT and there is nothing to stack.
- **Traits are physics.** Head sets the top: caps throw a brim out the side your Chog faces, bucket hats are a
  wide deck, crowns, horns and wizard hats are spikes nobody can stack on, headbands are flat, bare heads get two
  ears. Accessory adds a side nub. Aura sets the material (Burning bounces, Smoke slides). Tier sets size and
  weight. All 1,969 Chogs play differently, filled with their real art.
- **Holding is the turn.** One drop per Chog per day, checked with `ownerOf` on Monad when you drop. More Chogs
  means more drops.
- **Every Chog has a career.** Crowns, daily crowns, landings, misses, knock-offs and topples are stored per
  token ID and stay with the Chog when it changes hands.
- **$CHOG:** anyone can burn $CHOG to send a gust (500) or a quake (1,500) into the live tower. Burns are
  verified on-chain and tallied on the site.

**04 · Show it working.**
- Live: https://chogstack.nerom.site
- Demo video: _link_ (≤ 3 min)
- To test:
  1. Open the site. Without a wallet you can watch the live tower, play **Arcade** (Daily Stack: the same Chog
     order for everyone today, 3 lives, the score goes on a board), or **Practice** (drop any Chog onto a private
     copy of today's tower).
  2. Holders: click **Connect** and sign the message. It's free and doesn't send a transaction. Pick a Chog in
     the tray and press **DROP** or Space when the crane is over the summit. Q/E rotate.
  3. Click any block to see how its traits shaped it, plus its career.
  4. Burning $CHOG: press Gust or Quake and confirm the transfer in your wallet.

**05 · Under the hood.**
Repo: https://github.com/neromtoobad/chogstack.
Stack:
- Vanilla JS and Canvas
- matter.js physics shared by server and browser
- Express with Server-Sent Events: the server simulates every drop and streams the frames
- viem: Multicall3 owner index, signature sign-in, burn verification
- sharp

Metadata and art come from the collection's IPFS folders. Everything was built during the hackathon. No
pre-existing code.

**06 · What's next.**
_Usage numbers after launch._ Next: tower skins per season, Chog-vs-Chog head-to-head stacks, holder teams by
trait (all the cap Chogs against all the spikes), and a seasonal $CHOG pot for the summit.
