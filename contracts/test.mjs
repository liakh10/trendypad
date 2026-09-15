/* Runs Trendypad against a fork of Robinhood Chain mainnet (ethereumjs VM + RPCStateManager): the real Uniswap v4
   PoolManager, StateView and Universal Router, and a graduated Pons token standing in for $TRENDY in the buyback.
   Calls go through evm.runCall from arbitrary callers, so no keys are involved. */
import fs from 'node:fs';
import path from 'node:path';
import { VM } from '@ethereumjs/vm';
import { RPCStateManager } from '@ethereumjs/statemanager';
import { Common, Hardfork } from '@ethereumjs/common';
import { Block } from '@ethereumjs/block';
import { Address, Account, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { encodeFunctionData, decodeFunctionResult, decodeErrorResult, decodeEventLog, encodeDeployData, encodeAbiParameters, encodePacked, keccak256, parseAbi, formatEther, getAddress } from 'viem';

const RPC = 'https://robinhood-rpc.publicnode.com';
const realFetch = globalThis.fetch;
let rpcRetries = 0;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith(RPC)) return realFetch(url, opts);
  let last;
  for (let i = 0; i < 8; i++) {
    try {
      const text = await (await realFetch(url, opts)).text();
      const j = JSON.parse(text);
      if (j.result !== undefined) return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
      last = JSON.stringify(j.error || j);
    } catch (e) { last = e.message; }
    rpcRetries++;
    await new Promise(r => setTimeout(r, 250 * 2 ** i));
  }
  throw Error('RPC failed after retries: ' + last);
};

const dir = path.dirname(new URL(import.meta.url).pathname);
const art = n => JSON.parse(fs.readFileSync(path.join(dir, 'artifacts', n + '.json'), 'utf8'));
const TOKEN = art('TrendyToken'), PAD = art('TrendyPad'), FACTORY = art('TrendyFactory'), ROUTER = art('TrendyRouter'), BUYBACK = art('TrendyBuyback');
const ALL = [...TOKEN.abi, ...PAD.abi, ...FACTORY.abi, ...ROUTER.abi, ...BUYBACK.abi].filter((x, i, a) => x.type !== 'event' || a.findIndex(y => y.type === 'event' && y.name === x.name) === i);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const SV = parseAbi(['function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)']);
const C = { poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951', stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b', universalRouter: '0x8876789976dEcBfCbBbe364623C63652db8C0904' };
const PONS_TOKEN = '0xCc50404bd4219245eaE40415D6BAb679180f7F7E', PONS_HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';
export const PRESETS = { openTicks: [200200, 207200, 214000], curveTicks: [22000, 27800, 35800], openMcapEth: [2.0224, 1.0043, 0.5088] };
const DEAD = '0x000000000000000000000000000000000000dEaD', ZERO = '0x0000000000000000000000000000000000000000';
const E = n => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const head = await rpc('eth_getBlockByNumber', ['latest', false]);
const common = Common.custom({ chainId: 4663, networkId: 4663 }, { hardfork: Hardfork.Cancun });
class ForkState extends RPCStateManager {
  constructor(o) { super(o); this._codeStack = []; }
  async checkpoint() { await super.checkpoint(); this._codeStack.push(new Map(this._contractCache)); }
  async commit() { this._accountCache.commit(); this._storageCache.commit(); this._codeStack.pop(); }
  async revert() { this._accountCache.revert(); this._storageCache.revert(); const snap = this._codeStack.pop(); if (snap) this._contractCache = snap; }
}
const stateManager = new ForkState({ provider: RPC, blockTag: BigInt(head.number) });
stateManager._blockTag = 'latest';
const vm = await VM.create({ common, stateManager });
const now = BigInt(Math.floor(Date.now() / 1000)) + 600n;
const block = () => Block.fromBlockData({ header: { number: BigInt(head.number) + 1n, timestamp: now, gasLimit: 30_000_000n, baseFeePerGas: 0n } }, { common });

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => { if (c) pass++; else { fail++; console.log('  FAIL', label, extra); } };
const addr = n => getAddress('0x' + n.toString(16).padStart(40, '0'));

async function exec(from, to, data, value = 0n) {
  const r = await vm.evm.runCall({ caller: Address.fromString(from), to: to ? Address.fromString(to) : undefined, data: hexToBytes(data), gasLimit: 30_000_000n, value, block: block() });
  const e = r.execResult;
  let reason = null;
  if (e.exceptionError) { try { const d = decodeErrorResult({ abi: ALL, data: bytesToHex(e.returnValue) }); reason = d.args ? String(d.args[0]) : d.errorName; } catch { reason = e.exceptionError.error + ' ' + bytesToHex(e.returnValue); } }
  const logs = (e.logs || []).map(([a, topics, d]) => { try { return { address: getAddress(bytesToHex(a)), ...decodeEventLog({ abi: ALL, topics: topics.map(bytesToHex), data: bytesToHex(d) }) }; } catch { return null; } }).filter(Boolean);
  return { reverted: !!e.exceptionError, reason, logs, ret: bytesToHex(e.returnValue), gas: e.executionGasUsed, created: r.createdAddress ? getAddress(r.createdAddress.toString()) : null };
}
async function tx(from, to, abi, functionName, args = [], value = 0n) {
  const r = await exec(from, to, encodeFunctionData({ abi, functionName, args }), value);
  if (!r.reverted) try { r.result = decodeFunctionResult({ abi, functionName, data: r.ret }); } catch {}
  return r;
}
async function must(from, to, abi, fn, args = [], label = fn, value = 0n) {
  const r = await tx(from, to, abi, fn, args, value);
  ok(!r.reverted, label, r.reason || '');
  if (r.reverted) console.log('  ', label, 'reverted:', r.reason);
  return r;
}
async function reverts(from, to, abi, fn, args, expect, label, value = 0n) {
  const r = await tx(from, to, abi, fn, args, value);
  ok(r.reverted && (!expect || String(r.reason).includes(expect)), label, `reverted=${r.reverted} reason=${r.reason}`);
}
const view = async (to, abi, fn, args = []) => {
  const r = await tx(addr(1), to, abi, fn, args);
  if (r.reverted) throw Error(`${fn} reverted: ${r.reason}`);
  return r.result;
};
const bal = (token, who) => view(token, ERC20, 'balanceOf', [who]);
const ethBal = async who => (await vm.stateManager.getAccount(Address.fromString(who)))?.balance ?? 0n;
async function giveEth(who, wei) {
  const a = Address.fromString(who), acct = (await vm.stateManager.getAccount(a)) ?? new Account();
  acct.balance = wei;
  await vm.stateManager.putAccount(a, acct);
}
async function deploy(from, a, args = []) {
  const r = await exec(from, null, args.length ? encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args }) : a.bytecode);
  if (r.reverted) throw Error('deploy failed ' + a.contractName + ' ' + r.reason);
  const who = Address.fromString(from), acct = (await vm.stateManager.getAccount(who)) ?? new Account();
  acct.nonce += 1n;
  await vm.stateManager.putAccount(who, acct);
  return { address: r.created, gas: r.gas };
}
const POOL_KEY = { type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] };
const poolId = k => keccak256(encodeAbiParameters([POOL_KEY], [k]));
async function mcapEth(pad, token) {
  const key = await view(pad, PAD.abi, 'poolKeyOf', [token]);
  const [sqrt, tick] = await view(C.stateView, SV, 'getSlot0', [poolId(key)]);
  const s = Number(sqrt) / 2 ** 96;
  return { eth: 1e9 / (s * s), tick };
}
const launchedToken = r => r.logs.find(l => l.eventName === 'TokenLaunched').args.token;
const padFrom = r => r.logs.find(l => l.eventName === 'PadCreated').args.pad;

// ------------------------------------------------------------------ deploy
const deployer = addr(0xd0), keeper = addr(0x6e), alice = addr(0xa1), bob = addr(0xb0), carol = addr(0xc0), eve = addr(0xee), whale = addr(0x3a1e);
const tImpl = await deploy(deployer, TOKEN);
const pImpl = await deploy(deployer, PAD);
const fac = await deploy(deployer, FACTORY, [C.poolManager, pImpl.address, tImpl.address, PRESETS.openTicks, PRESETS.curveTicks, 50]);
const F = fac.address;
const rt = await deploy(deployer, ROUTER, [C.poolManager, F]);
const R = rt.address;
const bb = await deploy(deployer, BUYBACK);
const B = bb.address;
console.log(`fork block ${Number(head.number)} · gas: token impl ${tImpl.gas}, pad impl ${pImpl.gas}, factory ${fac.gas}, router ${rt.gas}, buyback ${bb.gas}`);
console.log(`  sizes: pad ${PAD.deployedSize}, factory ${FACTORY.deployedSize}, router ${ROUTER.deployedSize}, token ${TOKEN.deployedSize}, buyback ${BUYBACK.deployedSize}`);

{
  const r = await exec(deployer, null, encodeDeployData({ abi: FACTORY.abi, bytecode: FACTORY.bytecode, args: [C.poolManager, pImpl.address, tImpl.address, [200250, 207200, 214000], PRESETS.curveTicks, 50] }));
  ok(r.reverted && String(r.reason).includes('spacing'), 'factory refuses off-spacing presets', r.reason);
  const r2 = await exec(deployer, null, encodeDeployData({ abi: FACTORY.abi, bytecode: FACTORY.bytecode, args: [C.poolManager, pImpl.address, tImpl.address, PRESETS.openTicks, PRESETS.curveTicks, 150] }));
  ok(r2.reverted && String(r2.reason).includes('protocol fee'), 'factory refuses a protocol fee over 1%', r2.reason);
}
await reverts(alice, F, FACTORY.abi, 'createPad', ['Early', 100, 50, 0n, 1], 'not ready', 'createPad needs router and buyback');
await reverts(alice, F, FACTORY.abi, 'setRouter', [R], 'owner', 'setRouter only owner');
await must(deployer, F, FACTORY.abi, 'setRouter', [R]);
await must(deployer, F, FACTORY.abi, 'setBuyback', [B]);
await reverts(deployer, F, FACTORY.abi, 'setRouter', [alice], 'set', 'router can be set once');
await reverts(deployer, F, FACTORY.abi, 'setBuyback', [alice], 'set', 'buyback can be set once');

// ------------------------------------------------------------------ pads
await reverts(alice, F, FACTORY.abi, 'createPad', ['Bad', 600, 50, 0n, 1], 'fee', 'owner fee capped at 5%');
await reverts(alice, F, FACTORY.abi, 'createPad', ['Bad', 100, 400, 0n, 1], 'fee', 'creator fee capped at 3%');
await reverts(alice, F, FACTORY.abi, 'createPad', ['Bad', 100, 50, E(0.06), 1], 'launch fee', 'launch fee capped at 0.05 ETH');
await reverts(alice, F, FACTORY.abi, 'createPad', ['Bad', 100, 50, 0n, 3], 'curve', 'only three curves');
await reverts(alice, F, FACTORY.abi, 'createPad', ['', 100, 50, 0n, 1], 'name', 'name required');
const cp = await must(alice, F, FACTORY.abi, 'createPad', ['Moon Pad', 100, 50, E(0.001), 1], 'alice creates a Standard pad');
const P = padFrom(cp);
console.log(`  createPad gas ${cp.gas} · pad ${P}`);
ok((await view(P, PAD.abi, 'owner')) === alice && (await view(P, PAD.abi, 'poolFee')) === 20000 && (await view(P, PAD.abi, 'protocolFeeBps')) === 50, 'pad owner, 2% pool fee, 0.5% protocol');
ok((await view(F, FACTORY.abi, 'isPad', [P])) && (await view(F, FACTORY.abi, 'padCount')) === 1n && (await view(F, FACTORY.abi, 'padsOf', [alice])).length === 1, 'factory registry');
await reverts(eve, P, PAD.abi, 'initialize', [eve, 'x', 0, 0, 50, 0n, 0], 'init', 'pad cannot be re-initialized');
await reverts(eve, pImpl.address, PAD.abi, 'initialize', [eve, 'x', 0, 0, 50, 0n, 0], 'init', 'pad implementation is locked');
await must(deployer, F, FACTORY.abi, 'setProtocolFee', [80]);
const cp0 = await must(bob, F, FACTORY.abi, 'createPad', ['Soft Pad', 0, 0, 0n, 0], 'bob creates a Gentle pad with no owner or creator fee');
const P0 = padFrom(cp0);
ok((await view(P0, PAD.abi, 'poolFee')) === 8000 && (await view(P, PAD.abi, 'protocolFeeBps')) === 50, 'protocol fee change applies to new pads only');
await must(deployer, F, FACTORY.abi, 'setProtocolFee', [50]);
const cp2 = await must(carol, F, FACTORY.abi, 'createPad', ['Rocket Pad', 300, 200, 0n, 2], 'carol creates a Steep pad');
const P2 = padFrom(cp2);

// ------------------------------------------------------------------ launch
await giveEth(alice, E(10)); await giveEth(bob, E(10)); await giveEth(carol, E(10)); await giveEth(eve, E(1)); await giveEth(whale, E(20)); await giveEth(keeper, E(1));
await reverts(carol, P, PAD.abi, 'launch', ['Cat', 'CAT', 'u', 0n], 'launch fee', 'launch needs the pad launch fee', E(0.0005));
await reverts(carol, P, PAD.abi, 'launch', ['Cat', 'C', 'u', 0n], 'text', 'ticker needs 2 letters', E(0.001));
const la = await must(carol, P, PAD.abi, 'launch', ['Trend Cat', 'TCAT', 'https://trendypad.example/meta/1', 0n], 'carol launches with a 0.05 ETH first buy', E(0.051));
const T = launchedToken(la);
const dev = la.logs.find(l => l.eventName === 'TokenLaunched').args;
console.log(`  launch+buy gas ${la.gas} · token ${T}`);
ok(dev.devEth === E(0.05) && dev.devTokens > 0n && (await bal(T, carol)) === dev.devTokens, 'first buy landed with the creator', formatEther(dev.devTokens));
ok((await view(P, PAD.abi, 'claimable', [alice])) === E(0.001), 'launch fee owed to the pad owner');
ok((await view(T, TOKEN.abi, 'pad')) === P && (await view(T, TOKEN.abi, 'router')) === R && (await view(T, TOKEN.abi, 'creator')) === carol && (await view(T, TOKEN.abi, 'metadataURI')) === 'https://trendypad.example/meta/1', 'token fields');
ok((await bal(T, P)) === 0n, 'pad keeps no tokens');
ok((await bal(T, DEAD)) < 10n ** 9n, 'only rounding dust left at launch', String(await bal(T, DEAD)));
ok((await bal(T, C.poolManager)) + (await bal(T, carol)) + (await bal(T, DEAD)) === 10n ** 27n, 'whole supply in the pool or with the creator');
const m0 = await view(P, PAD.abi, 'marketOf', [T]);
ok(m0.openTick === 207200 && m0.capTick === 207200 - 27800 && m0.creator === carol, 'Standard curve ticks');
await reverts(eve, T, TOKEN.abi, 'initialize', ['x', 'XX', '', R, eve], 'init', 'token cannot be re-initialized');

for (const [pad, i, label] of [[P0, 0, 'Gentle'], [P2, 2, 'Steep']]) {
  const l = await must(eve, pad, PAD.abi, 'launch', [label + ' Coin', 'COIN', 'u', 0n], `launch on the ${label} pad without a buy`);
  const tok = launchedToken(l);
  const mc = await mcapEth(pad, tok);
  const want = PRESETS.openMcapEth[i];
  ok(Math.abs(mc.eth / want - 1) < 0.001, `${label} opening market cap ${want} ETH`, mc.eth.toFixed(4));
}
{
  const l = await must(eve, P, PAD.abi, 'launch', ['Plain', 'PLN', 'u', 0n], 'launch on Standard without a buy', E(0.001));
  const mc = await mcapEth(P, launchedToken(l));
  ok(Math.abs(mc.eth / 1.0043 - 1) < 0.001, 'Standard opening market cap 1 ETH', mc.eth.toFixed(4));
}

// ------------------------------------------------------------------ trading
const b1 = await must(bob, R, ROUTER.abi, 'buy', [T, 0n, bob], 'bob buys with 0.3 ETH', E(0.3));
console.log(`  buy gas ${b1.gas}`);
const bobTok = await bal(T, bob);
ok(bobTok > 0n, 'bob received tokens');
await reverts(bob, R, ROUTER.abi, 'buy', [T, 10n ** 30n, bob], 'min out', 'minOut guard on buys', E(0.01));
await reverts(bob, R, ROUTER.abi, 'buy', [addr(0x1234), 0n, bob], '', 'router refuses unknown tokens', E(0.01));
await reverts(bob, R, ROUTER.abi, 'buy', [T, 0n, bob], 'zero', 'zero buy refused');
{
  const e0 = await ethBal(bob);
  await reverts(bob, R, ROUTER.abi, 'sell', [T, bobTok / 2n, 10n ** 30n, bob], 'min out', 'minOut guard on sells');
  const s1 = await must(bob, R, ROUTER.abi, 'sell', [T, bobTok / 2n, 0n, bob], 'bob sells half without approval');
  console.log(`  sell gas ${s1.gas}`);
  ok((await ethBal(bob)) > e0 && (await bal(T, bob)) === bobTok - bobTok / 2n, 'bob got ETH back', formatEther((await ethBal(bob)) - e0));
  await reverts(eve, R, ROUTER.abi, 'sell', [T, 10n ** 18n, 0n, eve], 'transferFrom', 'cannot sell tokens you do not hold');
}

// ------------------------------------------------------------------ fees
{
  const bb0 = await ethBal(B), a0 = await view(P, PAD.abi, 'claimable', [alice]), c0 = await view(P, PAD.abi, 'claimable', [carol]), d0 = await bal(T, DEAD);
  const c1 = await must(eve, P, PAD.abi, 'collectFees', [T], 'anyone collects fees');
  console.log(`  collectFees gas ${c1.gas}`);
  const f = c1.logs.find(l => l.eventName === 'FeesCollected').args;
  ok(f.ethFees > 0n && f.tokenBurned > 0n, 'fees in ETH and in the token', `${formatEther(f.ethFees)} ETH`);
  ok(f.toOwner === f.ethFees * 100n / 200n && f.toCreator === f.ethFees * 50n / 200n && f.toProtocol === f.ethFees - f.toOwner - f.toCreator, 'split 1% owner / 0.5% creator / 0.5% protocol');
  ok((await ethBal(B)) - bb0 === f.toProtocol, 'protocol share went to the buyback');
  ok((await view(P, PAD.abi, 'claimable', [alice])) - a0 === f.toOwner && (await view(P, PAD.abi, 'claimable', [carol])) - c0 === f.toCreator, 'owner and creator accrued');
  ok((await bal(T, DEAD)) - d0 === f.tokenBurned, 'token fees burned');
  const expected = (E(0.05) + E(0.3)) * 20000n / 1000000n;
  const diff = f.ethFees > expected ? f.ethFees - expected : expected - f.ethFees;
  ok(diff * 1000n <= expected, 'ETH fees are 2% of ETH bought', `${formatEther(f.ethFees)} vs ${formatEther(expected)}`);
  const again = await must(eve, P, PAD.abi, 'collectFees', [T], 'second collect with nothing new');
  ok(again.logs.find(l => l.eventName === 'FeesCollected').args.ethFees === 0n, 'nothing collected twice');
  ok((await view(B, BUYBACK.abi, 'totalReceived')) === f.toProtocol, 'buyback counts what it received');
}
{
  const owed = await view(P, PAD.abi, 'claimable', [alice]), e0 = await ethBal(alice);
  await must(alice, P, PAD.abi, 'claim', [], 'owner claims');
  ok((await ethBal(alice)) - e0 === owed && (await view(P, PAD.abi, 'claimable', [alice])) === 0n, 'owner paid exactly');
  const owedC = await view(P, PAD.abi, 'claimable', [carol]), ec = await ethBal(carol);
  await must(eve, P, PAD.abi, 'claimFor', [carol], 'eve pushes the creator claim');
  ok((await ethBal(carol)) - ec === owedC, 'creator paid');
  ok((await view(P, PAD.abi, 'ownerEarned')) >= owed && (await view(P, PAD.abi, 'creatorsEarned')) === owedC, 'pad ledger');
}

// ------------------------------------------------------------------ through the curve
{
  const before = await mcapEth(P, T);
  const w = await must(whale, R, ROUTER.abi, 'buy', [T, 0n, whale], 'whale buys with 4 ETH', E(4));
  const after = await mcapEth(P, T);
  console.log(`  market cap ${before.eth.toFixed(3)} -> ${after.eth.toFixed(3)} ETH · tick ${before.tick} -> ${after.tick} · gas ${w.gas}`);
  ok(after.tick < m0.capTick && after.eth > 16, 'price passed the curve into the reserve range', after.eth.toFixed(2));
  const wt = await bal(T, whale);
  const e0 = await ethBal(whale);
  await must(whale, R, ROUTER.abi, 'sell', [T, wt, 0n, whale], 'whale sells everything back');
  const back = (await ethBal(whale)) - e0;
  ok(back < E(4) && back > E(3.7), 'whale gets back 4 ETH minus about 4% in fees', formatEther(back));
  const c3 = await must(eve, P, PAD.abi, 'collectFees', [T], 'collect after the whale');
  ok(c3.logs.find(l => l.eventName === 'FeesCollected').args.ethFees > E(0.07), 'whale fees collected');
}

// ------------------------------------------------------------------ owner and guards
await reverts(eve, P, PAD.abi, 'setLaunchFee', [0n], 'owner', 'launch fee only owner');
await reverts(alice, P, PAD.abi, 'setLaunchFee', [E(0.06)], 'launch fee', 'launch fee cap on the pad');
await must(alice, P, PAD.abi, 'setLaunchFee', [0n], 'owner sets launch fee to zero');
await must(alice, P, PAD.abi, 'transferOwnership', [bob]);
await reverts(eve, P, PAD.abi, 'acceptOwnership', [], 'pending', 'only pending owner accepts');
await must(bob, P, PAD.abi, 'acceptOwnership', []);
ok((await view(P, PAD.abi, 'owner')) === bob, 'pad ownership moved');
await reverts(eve, P, PAD.abi, 'unlockCallback', ['0x'], 'pool manager', 'pad callback only from PoolManager');
await reverts(eve, R, ROUTER.abi, 'unlockCallback', ['0x'], 'pool manager', 'router callback only from PoolManager');
{
  const r = await exec(eve, P, '0x', E(0.01));
  ok(r.reverted, 'pad refuses plain ETH from anyone but PoolManager');
}
ok(!PAD.abi.some(x => x.type === 'function' && /remove|withdraw|decrease|migrate/i.test(x.name)), 'pad has no function that removes liquidity');
ok(!BUYBACK.abi.some(x => x.type === 'function' && /withdraw|sweep|rescue/i.test(x.name)), 'buyback has no withdraw');

// ------------------------------------------------------------------ buyback on a real graduated Pons token
{
  await reverts(eve, B, BUYBACK.abi, 'buyBack', [C.universalRouter, '0x', 1n, 0n], 'keeper', 'buyBack only keeper or owner');
  await must(deployer, B, BUYBACK.abi, 'setKeeper', [keeper]);
  await must(deployer, B, BUYBACK.abi, 'setTrendy', [PONS_TOKEN], 'set $TRENDY stand-in');
  await reverts(deployer, B, BUYBACK.abi, 'setTrendy', [alice], 'set', 'token can be set once');
  await reverts(keeper, B, BUYBACK.abi, 'buyBack', [C.universalRouter, '0x', 1n, 0n], 'target', 'target must be allowed');
  await must(deployer, B, BUYBACK.abi, 'setTarget', [C.universalRouter, true]);
  const have = await ethBal(B);
  const key = { currency0: ZERO, currency1: PONS_TOKEN, fee: 0, tickSpacing: 200, hooks: PONS_HOOK };
  const swap = encodeAbiParameters([{ type: 'tuple', components: [{ ...POOL_KEY, name: 'poolKey' }, { name: 'zeroForOne', type: 'bool' }, { name: 'amountIn', type: 'uint128' }, { name: 'amountOutMinimum', type: 'uint128' }, { name: 'minHopPriceX36', type: 'uint256' }, { name: 'hookData', type: 'bytes' }] }], [{ poolKey: key, zeroForOne: true, amountIn: have, amountOutMinimum: 0n, minHopPriceX36: 0n, hookData: '0x' }]);
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [ZERO, have]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [PONS_TOKEN, 0n]);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [encodePacked(['uint8', 'uint8', 'uint8'], [0x06, 0x0c, 0x0f]), [swap, settle, take]]);
  const data = encodeFunctionData({ abi: parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']), functionName: 'execute', args: ['0x10', [input], now + 600n] });
  await reverts(keeper, B, BUYBACK.abi, 'buyBack', [C.universalRouter, data, have, 10n ** 40n], 'min out', 'buyback respects minOut');
  const dead0 = await bal(PONS_TOKEN, DEAD);
  const r = await must(keeper, B, BUYBACK.abi, 'buyBack', [C.universalRouter, data, have, 1n], 'keeper buys back through the Universal Router', 0n);
  const got = r.logs.find(l => l.eventName === 'BoughtBack');
  ok(got && got.args.trendyOut > 0n, 'tokens bought', got && formatEther(got.args.trendyOut));
  ok((await bal(PONS_TOKEN, B)) === 0n && (await bal(PONS_TOKEN, DEAD)) - dead0 === got.args.trendyOut, 'everything bought was burned');
  ok((await ethBal(B)) === 0n && (await view(B, BUYBACK.abi, 'totalEthSpent')) === have, 'all ETH spent on the buyback', formatEther(have));
}

console.log(`\n${pass} passed, ${fail} failed · rpc retries ${rpcRetries}`);
process.exit(fail ? 1 : 0);
