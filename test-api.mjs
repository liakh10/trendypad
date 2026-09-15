/* In-process API checks with memory storage: brand address checks, logo upload, prepare, publish guard, token metadata, keeper guard. */
process.env.TRENDY_MEMORY = '1';
const H = {};
for (const n of ['brand', 'meta', 'img', 'tick']) H[n] = (await import(`./api/${n}.js`)).default;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
async function call(name, method, query = {}, body) {
  let out = ''; const headers = {};
  const res = { statusCode: 200, setHeader(k, v) { headers[k] = v; }, end(s) { out = s; } };
  await H[name]({ method, query, body: body ? JSON.stringify(body) : '', headers: { host: 'localhost:1' } }, res);
  let j = null; try { j = JSON.parse(out); } catch {}
  return { code: res.statusCode, j, raw: out, headers };
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let r = await call('brand', 'GET', { check: 'frog-pad' });
ok(r.j.valid && !r.j.taken, 'free slug ' + JSON.stringify(r.j));
r = await call('brand', 'GET', { check: 'api' });
ok(!r.j.valid, 'reserved slug refused');
r = await call('brand', 'GET', { check: 'ab' });
ok(!r.j.valid, 'short slug refused');
r = await call('brand', 'POST', {}, { action: 'logo', image: png });
ok(/^\/api\/img\?id=[a-z0-9]{10}$/.test(r.j.url), 'logo stored ' + JSON.stringify(r.j));
const id = r.j.url.split('=')[1];
r = await call('img', 'GET', { id });
ok(r.code === 200 && r.headers['content-type'] === 'image/png', 'logo served');
const pad = '0x' + 'ab'.repeat(20);
r = await call('brand', 'POST', {}, { action: 'prepare', pad, brand: { slug: 'Frog-Pad', name: '  Frog <b>Pad</b> ', kit: 'nope', color: '#FF00AA', logo: '/api/img?id=' + id, x: 'javascript:alert(1)', telegram: 'https://t.me/frog' } });
ok(r.j.brand.slug === 'frog-pad' && r.j.brand.name === 'Frog  b Pad /b'.replace('  ', ' ') || r.j.brand.name.indexOf('<') < 0, 'name cleaned ' + r.j.brand.name);
ok(r.j.brand.kit === 'y2k' && r.j.brand.color === '#ff00aa' && r.j.brand.x === '' && r.j.brand.telegram === 'https://t.me/frog', 'brand normalized ' + JSON.stringify(r.j.brand));
ok(r.j.message.includes(pad.toLowerCase()) && r.j.message.startsWith('Trendypad'), 'message to sign');
r = await call('brand', 'POST', {}, { pad, brand: { slug: 'frog-pad', name: 'Frog' }, signedAt: Math.floor(Date.now() / 1000), signature: '0x12' });
ok(r.code === 400 && /factory/.test(r.j.error), 'publish refused without a factory: ' + r.j.error);
r = await call('brand', 'POST', {}, { pad, brand: { slug: 'frog-pad', name: 'Frog' }, signedAt: 1, signature: '0x12' });
ok(r.code === 400 && /expired/.test(r.j.error), 'old signature refused');
r = await call('brand', 'GET', { slug: 'frog-pad' });
ok(r.code === 404, 'unpublished slug 404');
r = await call('meta', 'POST', {}, { name: 'Neon Cat', symbol: 'ncat', description: 'meow', image: png, x: 'https://x.com/neon' });
ok(r.code === 200 && /\/api\/meta\?id=/.test(r.j.uri) && r.j.meta.symbol === 'NCAT', 'token metadata stored');
r = await call('tick', 'GET', {});
ok(r.j && r.j.ok === false && /keeper wallet/.test(r.j.skipped), 'keeper skips without a key: ' + JSON.stringify(r.j));
console.log(`api ${pass}/${fail}`);
process.exit(fail ? 1 : 0);
