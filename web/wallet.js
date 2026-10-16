// Injected-wallet sign-in (MetaMask, Rabby, Phantom, OKX...) on Monad mainnet, plus $CHOG burns.
const MONAD = {
  chainId: '0x8f', chainName: 'Monad', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: ['https://rpc.monad.xyz'], blockExplorerUrls: ['https://monadscan.com'],
};
const KEY = 'cs:session';

export const wallet = {
  address: null, token: null,
  load() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) Object.assign(this, s); } catch {}
    return !!this.token;
  },
  save() { try { localStorage.setItem(KEY, JSON.stringify({ address: this.address, token: this.token })); } catch {} },
  clear() { this.address = this.token = null; try { localStorage.removeItem(KEY); } catch {} },
  get eth() { return window.ethereum; },

  async ensureChain() {
    const eth = this.eth;
    const id = await eth.request({ method: 'eth_chainId' });
    if (id === MONAD.chainId) return;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MONAD.chainId }] });
    } catch (e) {
      if (e.code === 4902 || /Unrecognized|not added/i.test(e.message)) await eth.request({ method: 'wallet_addEthereumChain', params: [MONAD] });
      else throw e;
    }
  },

  async connect() {
    const dev = new URLSearchParams(location.search).get('dev'); // local testing; the server refuses this in production
    if (dev) { const r = await api('/api/dev-login', { address: dev }); this.address = r.address; this.token = r.token; this.save(); return r.address; }
    if (!this.eth)throw new Error('No wallet found. Open this page in a browser with MetaMask, Rabby or Phantom.');
    const [addr] = await this.eth.request({ method: 'eth_requestAccounts' });
    const { nonce, message } = await api('/api/nonce');
    const hex = '0x' + [...new TextEncoder().encode(message)].map(b => b.toString(16).padStart(2, '0')).join('');
    const signature = await this.eth.request({ method: 'personal_sign', params: [hex, addr] });
    const r = await api('/api/login', { address: addr, signature, nonce });
    this.address = r.address; this.token = r.token; this.save();
    return r.address;
  },

  async me() {
    if (!this.token) return null;
    try { return await api('/api/me', null, this.token); }
    catch (e) { if (e.status === 401) this.clear(); throw e; }
  },

  async drop(tokenId, x, angle, vx) {
    return api('/api/drop', { tokenId, x, angle, vx }, this.token);
  },

  // Sends `amount` whole $CHOG to the burn address, then asks the server to run the sabotage.
  async burn(kind, amount, cfg) {
    if (!this.eth) throw new Error('No wallet found');
    const [from] = await this.eth.request({ method: 'eth_requestAccounts' });
    await this.ensureChain();
    const wei = BigInt(amount) * 10n ** 18n;
    const data = '0xa9059cbb' + cfg.burn.slice(2).toLowerCase().padStart(64, '0') + wei.toString(16).padStart(64, '0');
    const tx = await this.eth.request({ method: 'eth_sendTransaction', params: [{ from, to: cfg.chogToken, data }] });
    return { tx, result: api('/api/sabotage', { tx, kind }) };
  },
};

export async function api(path, body, token) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
  return j;
}

export const short = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
