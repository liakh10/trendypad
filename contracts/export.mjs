/* Copies ABIs and bytecode for the site and /deploy into lib/abi, and writes lib/chain.json with the presets. */
import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(dir, '..', 'lib', 'abi');
fs.mkdirSync(out, { recursive: true });
for (const n of ['TrendyToken', 'TrendyPad', 'TrendyFactory', 'TrendyRouter', 'TrendyBuyback']) {
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts', n + '.json'), 'utf8'));
  fs.writeFileSync(path.join(out, n + '.json'), JSON.stringify({ contractName: n, compiler: a.compiler, abi: a.abi, bytecode: a.bytecode }));
}
fs.writeFileSync(path.join(dir, '..', 'lib', 'chain.json'), JSON.stringify({
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951', stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  universalRouter: '0x8876789976dEcBfCbBbe364623C63652db8C0904', ponsFactory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  openTicks: [200200, 207200, 214000], curveTicks: [22000, 27800, 35800], protocolFeeBps: 50
}, null, 1));
console.log('exported');
