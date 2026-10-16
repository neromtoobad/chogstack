// Monad reads: who owns which Chog, and verifying $CHOG burns.
import { createPublicClient, http, fallback, parseAbi, verifyMessage, getAddress, decodeEventLog } from 'viem';
import { monad } from 'viem/chains';

export const CHOG_NFT = '0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763';
export const CHOG_TOKEN = '0x350035555e10d9afaf1566aaebfced5ba6c27777';
export const BURN = '0x000000000000000000000000000000000000dEaD';
export const SUPPLY = 1969;

const RPCS = (process.env.RPC_URLS || 'https://rpc3.monad.xyz,https://rpc2.monad.xyz,https://rpc-mainnet.monadinfra.com,https://rpc.monad.xyz').split(',');
export const client = createPublicClient({ chain: monad, transport: fallback(RPCS.map(u => http(u, { timeout: 12000, retryCount: 2 }))) });

const nftAbi = parseAbi(['function ownerOf(uint256) view returns (address)']);
const erc20 = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);

// tokenId -> owner (checksummed). Rebuilt with Multicall3, ~4 eth_calls for the whole set.
export const owners = new Map();
let lastScan = 0;
let scanning = null;

export function scanOwners() {
  if (scanning) return scanning;
  scanning = (async () => {
    const ids = [...Array(SUPPLY)].map((_, i) => i + 1);
    const res = await client.multicall({
      contracts: ids.map(id => ({ address: CHOG_NFT, abi: nftAbi, functionName: 'ownerOf', args: [BigInt(id)] })),
      batchSize: 4000, allowFailure: true,
    });
    res.forEach((r, i) => { if (r.status === 'success') owners.set(ids[i], getAddress(r.result)); });
    lastScan = Date.now();
  })().finally(() => { scanning = null; });
  return scanning;
}

export async function ensureFresh(maxAgeMs = 60_000) {
  if (Date.now() - lastScan > maxAgeMs) await scanOwners().catch(e => console.error('scan', e.shortMessage || e.message));
}

export function ownedBy(addr) {
  const a = getAddress(addr);
  const out = [];
  for (const [id, o] of owners) if (o === a) out.push(id);
  return out.sort((x, y) => x - y);
}

export async function ownerOf(id) {
  const o = await client.readContract({ address: CHOG_NFT, abi: nftAbi, functionName: 'ownerOf', args: [BigInt(id)] });
  const a = getAddress(o);
  owners.set(id, a);
  return a;
}

export async function checkSignature(address, message, signature) {
  return verifyMessage({ address: getAddress(address), message, signature });
}

// Returns { from, amount } for a confirmed $CHOG transfer to the burn address inside tx, or throws.
export async function readBurn(hash) {
  const rcpt = await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 1000 });
  if (rcpt.status !== 'success') throw new Error('Transaction reverted');
  let total = 0n, from = null;
  for (const log of rcpt.logs) {
    if (log.address.toLowerCase() !== CHOG_TOKEN.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: erc20, data: log.data, topics: log.topics });
      if (ev.eventName === 'Transfer' && ev.args.to.toLowerCase() === BURN.toLowerCase()) {
        total += ev.args.value; from = getAddress(ev.args.from);
      }
    } catch { /* not a Transfer */ }
  }
  if (!from) throw new Error('No $CHOG burn found in that transaction');
  return { from, amount: total };
}
