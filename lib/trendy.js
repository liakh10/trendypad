/* Trendypad data layer: pads from the factory, markets from each pad, prices and uncollected fees from the Uniswap v4
   StateView, quotes by simulating the router, and every action. Loaded as an ES module next to wallet.js. */
import { pub, state as wallet, send, sign } from './wallet.js';
import { parseEther, parseAbi, encodeAbiParameters, keccak256, decodeEventLog, erc20Abi } from 'https://cdn.jsdelivr.net/npm/viem@2.21.55/+esm';

const valid = v => /^0x[0-9a-fA-F]{40}$/.test(v || '') ? v : null;
export const FACTORY = valid(window.TRENDY_FACTORY);
export const ROUTER = valid(window.TRENDY_ROUTER);
export const BUYBACK = valid(window.TRENDY_BUYBACK);
export const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
export const ZERO = '0x0000000000000000000000000000000000000000';
export const EXPLORER = 'https://robinscan.io';
const ETH_USD = '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9';
const MAX_TICK = 887200, Q128 = 1n << 128n, M256 = 1n << 256n;

export const CURVES = [
  { id: 0, name: 'Gentle', open: 2.02, end: 18.25, fill: 4.86, note: 'Opens at a 2 ETH market cap and climbs slowly' },
  { id: 1, name: 'Standard', open: 1.0, end: 16.19, fill: 3.23, note: 'Opens at 1 ETH, the balanced curve' },
  { id: 2, name: 'Steep', open: 0.51, end: 18.25, fill: 2.44, note: 'Opens at 0.5 ETH and climbs fast' }
];

const SV = parseAbi([
  'function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)',
  'function getFeeGrowthInside(bytes32,int24,int24) view returns (uint256,uint256)',
  'function getPositionInfo(bytes32,address,int24,int24,bytes32) view returns (uint128,uint256,uint256)'
]);
const FEED = parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);

let A = null;
export async function abis() {
  if (A) return A;
  const get = async n => { for (let i = 0; i < 3; i++) { try { const r = await fetch('/lib/abi/' + n + '.json?v=1'); if (r.ok) return (await r.json()).abi; } catch {} await new Promise(r => setTimeout(r, 400 * (i + 1))); } throw Error('Could not load ' + n); };
  const [T, P, F, R, B] = await Promise.all(['TrendyToken', 'TrendyPad', 'TrendyFactory', 'TrendyRouter', 'TrendyBuyback'].map(get));
  A = { T, P, F, R, B };
  return A;
}

export const poolId = k => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
export const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
export const eth = wei => Number(wei || 0n) / 1e18;
export const fmtEth = (v, d) => { v = Number(v || 0); if (d != null) return v.toFixed(d); return v === 0 ? '0' : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(5); };

export async function ethUsd() {
  try { const r = await pub.readContract({ address: ETH_USD, abi: FEED, functionName: 'latestRoundData' }); return Number(r[1]) / 1e8; } catch { return null; }
}

const PAD_FIELDS = ['name', 'owner', 'poolFee', 'ownerFeeBps', 'creatorFeeBps', 'protocolFeeBps', 'curve', 'launchFee', 'marketCount', 'totalEthFees', 'protocolPaid', 'ownerEarned', 'creatorsEarned', 'createdAt'];
async function padInfo(list) {
  const { P } = await abis();
  const res = await pub.multicall({ allowFailure: true, contracts: list.flatMap(a => PAD_FIELDS.map(f => ({ address: a, abi: P, functionName: f }))) });
  return list.map((a, i) => {
    const o = { pad: a };
    PAD_FIELDS.forEach((f, k) => { o[f] = res[i * PAD_FIELDS.length + k].result; });
    o.marketCount = Number(o.marketCount || 0n);
    o.curve = Number(o.curve ?? 1);
    o.poolFeePct = Number(o.poolFee || 0) / 10000;
    o.createdAt = Number(o.createdAt || 0n);
    return o;
  });
}

export async function loadPads() {
  if (!FACTORY) return [];
  const { F } = await abis();
  const n = Number(await pub.readContract({ address: FACTORY, abi: F, functionName: 'padCount' }));
  let list = [];
  for (let i = 0; i < n; i += 200) list = list.concat(await pub.readContract({ address: FACTORY, abi: F, functionName: 'pads', args: [BigInt(i), 200n] }));
  return list.length ? padInfo(list) : [];
}

export async function padsOf(who) {
  if (!FACTORY || !who) return [];
  const { F } = await abis();
  const list = await pub.readContract({ address: FACTORY, abi: F, functionName: 'padsOf', args: [who] });
  return list.length ? padInfo([...list]) : [];
}

export async function protocolFeeBps() {
  if (!FACTORY) return 50;
  const { F } = await abis();
  return Number(await pub.readContract({ address: FACTORY, abi: F, functionName: 'protocolFeeBps' }).catch(() => 50));
}

/* one pad with all its tokens: price, market cap in ETH, curve progress and uncollected ETH fees */
export async function loadPad(pad) {
  const { P, T } = await abis();
  const [info] = await padInfo([pad]);
  if (!info.owner) throw Error('This pad was not found on Robinhood Chain');
  let markets = [];
  for (let i = 0; i < info.marketCount; i += 200) markets = markets.concat(await pub.readContract({ address: pad, abi: P, functionName: 'markets', args: [BigInt(i), 200n] }));
  const rows = markets.map(m => {
    const key = { currency0: ZERO, currency1: m.token, fee: info.poolFee, tickSpacing: 200, hooks: ZERO };
    return { ...m, key, id: poolId(key), ranges: [[m.capTick, m.openTick], [-MAX_TICK, m.capTick]], createdAt: Number(m.createdAt) };
  });
  info.uncollectedEth = 0n;
  if (rows.length) {
    const W = 8;
    const res = await pub.multicall({ allowFailure: true, contracts: rows.flatMap(r => [
      { address: r.token, abi: T, functionName: 'name' }, { address: r.token, abi: T, functionName: 'symbol' }, { address: r.token, abi: T, functionName: 'metadataURI' },
      { address: STATE_VIEW, abi: SV, functionName: 'getSlot0', args: [r.id] },
      ...r.ranges.flatMap(([lo, hi]) => [
        { address: STATE_VIEW, abi: SV, functionName: 'getFeeGrowthInside', args: [r.id, lo, hi] },
        { address: STATE_VIEW, abi: SV, functionName: 'getPositionInfo', args: [r.id, pad, lo, hi, '0x' + '0'.repeat(64)] }
      ])
    ]) });
    rows.forEach((r, i) => {
      const g = k => res[i * W + k].result;
      r.name = g(0) || ''; r.symbol = g(1) || ''; r.uri = g(2) || '';
      const s0 = g(3);
      r.tick = s0 ? s0[1] : r.openTick;
      const s = s0 ? Number(s0[0]) / 2 ** 96 : 0;
      r.priceEth = s ? 1 / (s * s) : 0;
      r.mcapEth = s ? 1e9 / (s * s) : null;
      r.progress = Math.max(0, (r.openTick - r.tick) / (r.openTick - r.capTick));
      let unc0 = 0n;
      for (let k = 0; k < 2; k++) {
        const inside = g(4 + k * 2), pos = g(5 + k * 2);
        if (inside && pos) unc0 += pos[0] * ((inside[0] - pos[1] + M256) % M256) / Q128;
      }
      r.uncollectedEth = unc0;
      info.uncollectedEth += unc0;
    });
  }
  info.tokens = rows.reverse();
  info.curveInfo = CURVES[info.curve] || CURVES[1];
  return info;
}

const metaCache = new Map();
export function meta(uri) {
  if (!/^https?:\/\//.test(uri || '')) return Promise.resolve(null);
  if (!metaCache.has(uri)) metaCache.set(uri, fetch(uri).then(r => r.ok ? r.json() : null).catch(() => null));
  return metaCache.get(uri);
}

export async function buybackStats() {
  if (!BUYBACK) return null;
  const { B } = await abis();
  const res = await pub.multicall({ allowFailure: true, contracts: ['totalReceived', 'totalEthSpent', 'totalBurned', 'trendy'].map(f => ({ address: BUYBACK, abi: B, functionName: f })) });
  const balance = await pub.getBalance({ address: BUYBACK }).catch(() => 0n);
  return { received: res[0].result || 0n, spent: res[1].result || 0n, burned: res[2].result || 0n, trendy: res[3].result || ZERO, balance };
}

// ---------------------------------------------------------------- actions

const me = () => { const w = wallet(); if (!w.address) throw Error('Connect a wallet first'); return w.address; };
const DUMMY = '0x000000000000000000000000000000000000bEEF';

async function run(call, onStep) {
  onStep && onStep('Confirm in your wallet');
  const t = await send(call);
  onStep && onStep('Waiting for Robinhood Chain');
  const rc = await t.wait();
  if (rc.status !== 'success') throw Error('Transaction reverted');
  return rc;
}
function findEvent(rc, abi, name, address) {
  for (const l of rc.logs) {
    if (address && l.address.toLowerCase() !== address.toLowerCase()) continue;
    try { const d = decodeEventLog({ abi, data: l.data, topics: l.topics }); if (d.eventName === name) return d.args; } catch {}
  }
  return null;
}

export async function createPad({ name, ownerBps, creatorBps, launchFee, curve }, onStep) {
  if (!FACTORY) throw Error('The Trendypad factory is not deployed yet');
  const { F } = await abis();
  me();
  const rc = await run({ address: FACTORY, abi: F, functionName: 'createPad', args: [name, ownerBps, creatorBps, launchFee, curve] }, onStep);
  const ev = findEvent(rc, F, 'PadCreated', FACTORY);
  if (!ev) throw Error('The pad was created but its address was not found in the receipt');
  return ev.pad;
}

export async function launchToken(pad, { name, symbol, uri, devEth, launchFee }, onStep) {
  const { P } = await abis();
  const w = me(), value = launchFee + devEth;
  let minOut = 0n;
  if (devEth > 0n) {
    onStep && onStep('Quoting your first buy');
    const sim = await pub.simulateContract({ account: w, address: pad, abi: P, functionName: 'launch', args: [name, symbol, uri, 0n], value });
    minOut = sim.result[1] * 95n / 100n;
  }
  const rc = await run({ address: pad, abi: P, functionName: 'launch', args: [name, symbol, uri, minOut], value }, onStep);
  const ev = findEvent(rc, P, 'TokenLaunched', pad);
  return ev ? ev.token : null;
}

export async function quoteBuy(token, wei) {
  const { R } = await abis();
  const from = wallet().address || DUMMY;
  return (await pub.simulateContract({ account: from, address: ROUTER, abi: R, functionName: 'buy', args: [token, 0n, from], value: wei, stateOverride: [{ address: from, balance: wei * 2n + parseEther('1') }] })).result;
}
export async function quoteSell(token, amount) {
  const { R } = await abis();
  const w = me();
  return (await pub.simulateContract({ account: w, address: ROUTER, abi: R, functionName: 'sell', args: [token, amount, 0n, w] })).result;
}
export async function buy(token, wei, slippageBps, onStep) {
  const { R } = await abis();
  const w = me();
  onStep && onStep('Quoting');
  const out = await quoteBuy(token, wei);
  return run({ address: ROUTER, abi: R, functionName: 'buy', args: [token, out * BigInt(10000 - slippageBps) / 10000n, w], value: wei }, onStep);
}
export async function sell(token, amount, slippageBps, onStep) {
  const { R } = await abis();
  const w = me();
  onStep && onStep('Quoting');
  const out = await quoteSell(token, amount);
  return run({ address: ROUTER, abi: R, functionName: 'sell', args: [token, amount, out * BigInt(10000 - slippageBps) / 10000n, w] }, onStep);
}

export const collectFees = async (pad, token, onStep) => run({ address: pad, abi: (await abis()).P, functionName: 'collectFees', args: [token] }, onStep);
export const claim = async (pad, onStep) => run({ address: pad, abi: (await abis()).P, functionName: 'claim' }, onStep);
export async function claimable(pad, who) {
  const { P } = await abis();
  return pub.readContract({ address: pad, abi: P, functionName: 'claimable', args: [who] }).catch(() => 0n);
}
export async function balances(tokens, who) {
  if (!who || !tokens.length) return {};
  const res = await pub.multicall({ allowFailure: true, contracts: tokens.map(t => ({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [who] })) });
  return Object.fromEntries(tokens.map((t, i) => [t.toLowerCase(), res[i].result || 0n]));
}

// ---------------------------------------------------------------- site API

async function postJSON(path, data) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || 'Request failed');
  return j;
}

export async function publishBrand(pad, brand, onStep) {
  onStep && onStep('Preparing the site');
  const prep = await postJSON('/api/brand', { action: 'prepare', pad, brand });
  onStep && onStep('Sign the site in your wallet');
  const signature = await sign(prep.message);
  onStep && onStep('Publishing');
  return postJSON('/api/brand', { pad, brand: prep.brand, signedAt: prep.signedAt, signature });
}
export const uploadLogo = image => postJSON('/api/brand', { action: 'logo', image }).then(j => j.url);
export const uploadMeta = fields => postJSON('/api/meta', fields);

/* any image file into a square WebP data URL */
export function toWebp(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(Error('Pick an image file'));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d'), s = Math.min(img.width, img.height);
      x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/webp', 0.9));
    };
    img.onerror = () => reject(Error('That image could not be read'));
    img.src = URL.createObjectURL(file);
  });
}
