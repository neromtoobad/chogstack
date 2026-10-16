import { client, readBurn, CHOG_TOKEN, BURN } from '../server/chain.js';
import { parseAbiItem } from 'viem';
const ev = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const tip = await client.getBlockNumber();
let found = null, burn = null;
for (let i = 0; i < 40 && !(found && burn); i++) {
  const to = tip - BigInt(i * 1000), from = to - 999n;
  const logs = await client.getLogs({ address: CHOG_TOKEN, event: ev, fromBlock: from, toBlock: to }).catch(e => { console.log('getLogs', e.shortMessage); return []; });
  for (const l of logs) { if (!found && l.args.to.toLowerCase() !== BURN.toLowerCase()) found = l; if (!burn && l.args.to.toLowerCase() === BURN.toLowerCase()) burn = l; }
}
console.log('plain transfer', found?.transactionHash, 'burn', burn?.transactionHash);
if (found) try { await readBurn(found.transactionHash); } catch (e) { console.log('plain ->', e.message); }
if (burn) console.log('burn ->', await readBurn(burn.transactionHash));
