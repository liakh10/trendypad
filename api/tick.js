/* Buyback keeper (GitHub Actions cron with CRON_SECRET, or a page poke at most every 10 minutes).
   1. collect  fees of tokens that have at least 0.001 ETH uncollected, so the protocol share reaches the buyback
   2. buyback  once $TRENDY trades in its Uniswap v4 pool, spend the buyback's ETH on $TRENDY through the Universal
               Router; the buyback contract burns everything it receives in the same transaction
   The key is TRENDY_OPERATOR_KEY and its address has to be set as the buyback keeper on /deploy. */
import { createPublicClient, createWalletClient, http, fallback, parseAbi, parseEther, formatEther, encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, decodeFunctionResult, erc20Abi, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { redis } from '../lib/store.js';
import { json } from '../lib/http.js';
import { siteConfig } from '../lib/siteconfig.js';

const RPCS = ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com'];
const CHAIN = { id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: RPCS } }, contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } } };
const pub = createPublicClient({ chain: CHAIN, transport: fallback(RPCS.map(u => http(u, { timeout: 15000 }))) });
const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b', UR = '0x8876789976dEcBfCbBbe364623C63652db8C0904', PONS = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const ZERO = '0x0000000000000000000000000000000000000000', MAX_TICK = 887200, Q128 = 1n << 128n, M256 = 1n << 256n;
const F = parseAbi(['function padCount() view returns (uint256)', 'function pads(uint256,uint256) view returns (address[])']);
const P = parseAbi(['function poolFee() view returns (uint24)', 'function marketCount() view returns (uint256)', 'function markets(uint256,uint256) view returns ((address token,address creator,int24 openTick,int24 capTick,uint64 createdAt,uint256 ethFees,uint256 tokenBurned)[])', 'function collectFees(address) returns (uint256,uint256)']);
const SV = parseAbi(['function getFeeGrowthInside(bytes32,int24,int24) view returns (uint256,uint256)', 'function getPositionInfo(bytes32,address,int24,int24,bytes32) view returns (uint128,uint256,uint256)']);
const BB = parseAbi(['function trendy() view returns (address)', 'function keeper() view returns (address)', 'function allowedTarget(address) view returns (bool)', 'function buyBack(address,bytes,uint256,uint256) returns (uint256)']);
const PF = parseAbi(['function memeHook() view returns (address)', 'function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))']);
const POOL_KEY = { type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] };
const MIN_COLLECT = parseEther('0.001'), MIN_BUYBACK = parseEther('0.003'), BUDGET_MS = 45000;

function operator() {
  const key = process.env.TRENDY_OPERATOR_KEY || '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw Error('The keeper wallet is not configured yet.');
  const account = privateKeyToAccount(key);
  return { account, address: account.address, wallet: createWalletClient({ account, chain: CHAIN, transport: http(RPCS[0], { timeout: 30000 }) }) };
}
async function sendTx(o, tx) {
  const hash = await o.wallet.sendTransaction({ account: o.account, chain: CHAIN, ...tx });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60000 });
  if (rc.status !== 'success') throw Error('Transaction reverted ' + hash);
  return hash;
}
async function rpc(req) {
  let last;
  for (const url of RPCS) {
    try { return JSON.parse(await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })).text()); } catch (e) { last = e; }
  }
  throw Error('RPC unavailable: ' + (last && last.message));
}

function swapCalldata(key, amountIn, minOut) {
  const swap = encodeAbiParameters([{ type: 'tuple', components: [{ ...POOL_KEY, name: 'poolKey' }, { name: 'zeroForOne', type: 'bool' }, { name: 'amountIn', type: 'uint128' }, { name: 'amountOutMinimum', type: 'uint128' }, { name: 'minHopPriceX36', type: 'uint256' }, { name: 'hookData', type: 'bytes' }] }], [{ poolKey: key, zeroForOne: true, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: '0x' }]);
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [ZERO, amountIn]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key.currency1, minOut]);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [encodePacked(['uint8', 'uint8', 'uint8'], [0x06, 0x0c, 0x0f]), [swap, settle, take]]);
  return encodeFunctionData({ abi: parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']), functionName: 'execute', args: ['0x10', [input], BigInt(Math.floor(Date.now() / 1000) + 600)] });
}

async function collect(o, factory, started, log) {
  const n = Number(await pub.readContract({ address: factory, abi: F, functionName: 'padCount' }));
  if (!n) return;
  const pads = await pub.readContract({ address: factory, abi: F, functionName: 'pads', args: [0n, 500n] });
  for (const pad of pads) {
    const [fee, count] = await Promise.all([pub.readContract({ address: pad, abi: P, functionName: 'poolFee' }), pub.readContract({ address: pad, abi: P, functionName: 'marketCount' })]);
    if (!count) continue;
    const markets = await pub.readContract({ address: pad, abi: P, functionName: 'markets', args: [0n, 500n] });
    const rows = markets.map(m => ({ m, id: keccak256(encodeAbiParameters([POOL_KEY], [{ currency0: ZERO, currency1: m.token, fee, tickSpacing: 200, hooks: ZERO }])), ranges: [[m.capTick, m.openTick], [-MAX_TICK, m.capTick]] }));
    const res = await pub.multicall({ allowFailure: true, contracts: rows.flatMap(r => r.ranges.flatMap(([lo, hi]) => [{ address: STATE_VIEW, abi: SV, functionName: 'getFeeGrowthInside', args: [r.id, lo, hi] }, { address: STATE_VIEW, abi: SV, functionName: 'getPositionInfo', args: [r.id, pad, lo, hi, '0x' + '0'.repeat(64)] }])) });
    for (let i = 0; i < rows.length; i++) {
      let unc = 0n;
      for (let k = 0; k < 2; k++) {
        const inside = res[i * 4 + k * 2].result, pos = res[i * 4 + k * 2 + 1].result;
        if (inside && pos) unc += pos[0] * ((inside[0] - pos[1] + M256) % M256) / Q128;
      }
      if (unc < MIN_COLLECT) continue;
      if (Date.now() - started > BUDGET_MS) return log.push({ partial: true });
      const hash = await sendTx(o, { to: pad, data: encodeFunctionData({ abi: P, functionName: 'collectFees', args: [rows[i].m.token] }) });
      log.push({ collected: rows[i].m.token, eth: formatEther(unc), tx: hash });
    }
  }
}

async function buyback(o, bb, log) {
  const [trendy, keeper, allowed, balance] = await Promise.all([
    pub.readContract({ address: bb, abi: BB, functionName: 'trendy' }),
    pub.readContract({ address: bb, abi: BB, functionName: 'keeper' }),
    pub.readContract({ address: bb, abi: BB, functionName: 'allowedTarget', args: [UR] }),
    pub.getBalance({ address: bb })
  ]);
  if (trendy === ZERO) return log.push({ buyback: 'waiting for $TRENDY to be set on the buyback' });
  if (keeper.toLowerCase() !== o.address.toLowerCase()) return log.push({ buyback: 'the keeper wallet is not the buyback keeper' });
  if (!allowed) return log.push({ buyback: 'the Universal Router is not an allowed target' });
  if (balance < MIN_BUYBACK) return log.push({ buyback: 'under 0.003 ETH, waiting', balance: formatEther(balance) });
  const info = await pub.readContract({ address: PONS, abi: PF, functionName: 'getLaunchedToken', args: [trendy] });
  if (!info.exists || info.phase !== 2) return log.push({ buyback: '$TRENDY has not graduated to its Uniswap v4 pool yet' });
  const hook = await pub.readContract({ address: PONS, abi: PF, functionName: 'memeHook' });
  const key = { currency0: ZERO, currency1: trendy, fee: info.poolFee, tickSpacing: info.tickSpacing, hooks: hook };
  const bal = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [bb] });
  const sim = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls: [{ from: bb, to: trendy, data: bal }, { from: bb, to: UR, data: swapCalldata(key, balance, 0n), value: toHex(balance) }, { from: bb, to: trendy, data: bal }] }], validation: false }, 'latest'] });
  const calls = sim.result && sim.result[0].calls;
  if (!calls || calls[1].status !== '0x1') return log.push({ buyback: 'quote failed' });
  const read = c => decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: c.returnData });
  const out = read(calls[2]) - read(calls[0]);
  const minOut = out * 97n / 100n;
  const hash = await sendTx(o, { to: bb, data: encodeFunctionData({ abi: BB, functionName: 'buyBack', args: [UR, swapCalldata(key, balance, minOut), balance, minOut] }) });
  log.push({ boughtAndBurned: formatEther(out), eth: formatEther(balance), tx: hash });
}

export default async function handler(req, res) {
  const R = redis(), q = req.query || {}, secret = process.env.CRON_SECRET;
  const authed = secret && (req.headers.authorization === 'Bearer ' + secret || q.secret === secret);
  if (!authed && !(await R.set('td:poke', '1', { nx: true, ex: 600 }))) return json(res, 200, { ok: true, skipped: 'recent run' });
  let o;
  try { o = operator(); } catch (e) { return json(res, 200, { ok: false, skipped: e.message }); }
  const cfg = await siteConfig(req);
  if (!cfg.factory || !cfg.buyback) return json(res, 200, { ok: false, skipped: 'contracts are not in config.js yet' });
  const lock = Math.random().toString(36).slice(2);
  if (!(await R.set('td:lock:keeper', lock, { nx: true, px: 58000 }))) return json(res, 200, { ok: true, skipped: 'keeper busy' });
  const log = [], started = Date.now();
  try {
    await collect(o, cfg.factory, started, log).catch(e => log.push({ collectError: e.shortMessage || e.message }));
    await buyback(o, cfg.buyback, log).catch(e => log.push({ buybackError: e.shortMessage || e.message }));
    json(res, 200, { ok: true, log });
  } finally {
    if ((await R.get('td:lock:keeper')) === lock) await R.del('td:lock:keeper');
  }
}
