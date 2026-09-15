/* Trend kits: the eight styles a pad site can wear. Each kit is a font pair plus CSS on one shared page structure, and
   the pad's brand color becomes its accent. padDocument() renders a full page for the builder preview; padMarkup()
   renders the body that pad.html makes interactive. */

export const KITS = [
  { id: 'y2k', name: 'Y2K Chrome', note: 'Chrome gradients, sparkles, bubble type', fonts: 'family=Syncopate:wght@400;700&family=Space+Grotesk:wght@400;600' },
  { id: 'terminal', name: 'Terminal', note: 'Black screen, mono type, blinking cursor', fonts: 'family=VT323&family=IBM+Plex+Mono:wght@400;600' },
  { id: 'newsprint', name: 'Newsprint', note: 'Paper, serif headlines, column rules', fonts: 'family=Playfair+Display:wght@700;900&family=Libre+Franklin:wght@400;600' },
  { id: 'arcade', name: 'Arcade', note: 'Pixel type, neon frames, dark cabinet', fonts: 'family=Press+Start+2P&family=Space+Mono:wght@400;700' },
  { id: 'glass', name: 'Glass', note: 'Frosted cards over a color mesh', fonts: 'family=Sora:wght@400;600;800' },
  { id: 'brutal', name: 'Brutalist', note: 'Thick borders, hard shadows, loud blocks', fonts: 'family=Archivo+Black&family=Archivo:wght@400;600' },
  { id: 'soft', name: 'Soft Pastel', note: 'Rounded blobs, pastel fills, friendly type', fonts: 'family=Fredoka:wght@500;700&family=Nunito:wght@400;700' },
  { id: 'street', name: 'Street Tape', note: 'Caution tape, stickers, condensed type', fonts: 'family=Anton&family=Barlow:wght@400;600' }
];
export const kitById = id => KITS.find(k => k.id === id) || KITS[0];

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export function onColor(hex) { const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#111111' : '#ffffff'; }
function mix(hex, other, t) { const a = rgb(hex), b = rgb(other); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

const BASE = `
.tp{--acc:#ff2d87;--on:#fff;min-height:100%;font-size:15px;line-height:1.5;overflow-x:hidden}
.tp *{box-sizing:border-box}
.tp img{max-width:100%;display:block}
.tp a{color:inherit;text-decoration:none}
.tp button{font:inherit;cursor:pointer}
.tp-wrap{width:min(1120px,100%);margin:0 auto;padding:0 20px}
.tp-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0}
.tp-brand{display:flex;align-items:center;gap:10px;min-width:0}
.tp-logo{width:40px;height:40px;flex:none;border-radius:10px;object-fit:cover;background:var(--acc);display:grid;place-items:center;color:var(--on);font-weight:800}
.tp-brand b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-nav{display:flex;gap:8px;align-items:center}
.tp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:42px;padding:0 18px;border:0;background:var(--acc);color:var(--on);font-weight:700;white-space:nowrap}
.tp-btn.ghost{background:transparent;color:inherit;border:1px solid currentColor}
.tp-hero{padding:56px 0 40px}
.tp-hero h1{margin:0;line-height:1;overflow-wrap:anywhere}
.tp-hero p{margin:16px 0 0;max-width:56ch;opacity:.8}
.tp-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px;align-items:center}
.tp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:8px 0 28px}
.tp-stat{padding:14px}
.tp-stat span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.65}
.tp-stat b{font-size:22px}
.tp-h2{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 14px}
.tp-h2 h2{margin:0}
.tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;padding-bottom:40px}
.tp-card{display:flex;flex-direction:column;gap:10px;padding:14px;text-align:left;color:inherit;border:0;width:100%}
.tp-card-top{display:flex;gap:10px;align-items:center;min-width:0}
.tp-card-top img,.tp-card-top i{width:48px;height:48px;flex:none;object-fit:cover;background:var(--acc);display:grid;place-items:center;color:var(--on);font-style:normal;font-weight:800}
.tp-card-top div{min-width:0}
.tp-card-top b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-card-top small{opacity:.7}
.tp-row{display:flex;justify-content:space-between;font-size:13px}
.tp-bar{height:8px;background:rgba(127,127,127,.25);overflow:hidden}
.tp-bar s{display:block;height:100%;background:var(--acc)}
.tp-empty{padding:30px;text-align:center;opacity:.7;grid-column:1/-1}
.tp-foot{padding:28px 0 36px;font-size:12px;opacity:.65;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
@media (max-width:640px){.tp-stats{grid-template-columns:repeat(2,1fr)}.tp-hero{padding:32px 0 28px}.tp-nav .ghost{display:none}}
`;

const CSS = {
  y2k: `
.tp.kit-y2k{background:radial-gradient(circle at 15% 10%,#ffffff 0,transparent 30%),linear-gradient(135deg,#e9ecf5,#cfd6e6 40%,#f4f0ff 70%,#dfe8f2);color:#1a1d2b;font-family:'Space Grotesk',sans-serif}
.kit-y2k .tp-hero h1,.kit-y2k .tp-h2 h2,.kit-y2k .tp-brand b{font-family:'Syncopate',sans-serif;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
.kit-y2k .tp-hero h1{font-size:clamp(34px,7vw,84px);background:linear-gradient(180deg,#fff 0,#9aa3b8 45%,#3b4256 50%,#c9d0de 75%,#fff);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:1px rgba(26,29,43,.35);filter:drop-shadow(0 6px 14px rgba(0,0,0,.18))}
.kit-y2k .tp-btn{border-radius:999px;background:linear-gradient(180deg,var(--acc2),var(--acc));box-shadow:inset 0 2px 0 rgba(255,255,255,.6),0 6px 16px rgba(0,0,0,.18)}
.kit-y2k .tp-btn.ghost{background:linear-gradient(180deg,#fff,#d9dfeb);color:#1a1d2b;border:0}
.kit-y2k .tp-stat,.kit-y2k .tp-card{border-radius:22px;background:linear-gradient(160deg,rgba(255,255,255,.95),rgba(214,221,235,.8));box-shadow:inset 0 1px 0 #fff,0 10px 24px rgba(40,50,80,.14)}
.kit-y2k .tp-logo,.kit-y2k .tp-card-top img,.kit-y2k .tp-card-top i{border-radius:50%}
.kit-y2k .tp-bar{border-radius:9px}.kit-y2k .tp-bar s{border-radius:9px;background:linear-gradient(90deg,var(--acc),var(--acc2))}
.kit-y2k .tp-hero{position:relative}
.kit-y2k .tp-hero::after{content:"✦  ✧  ✦";position:absolute;right:4%;top:30px;font-size:34px;color:var(--acc);letter-spacing:.3em;opacity:.8}`,
  terminal: `
.tp.kit-terminal{background:#050807;color:#d8ffe6;font-family:'IBM Plex Mono',monospace;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px)}
.kit-terminal .tp-hero h1,.kit-terminal .tp-h2 h2,.kit-terminal .tp-stat b,.kit-terminal .tp-brand b{font-family:'VT323',monospace;font-weight:400}
.kit-terminal .tp-hero h1{font-size:clamp(46px,9vw,112px);color:var(--acc);text-shadow:0 0 18px color-mix(in srgb,var(--acc) 60%,transparent)}
.kit-terminal .tp-hero h1::before{content:"> "}
.kit-terminal .tp-hero h1::after{content:"_";animation:tpblink 1s steps(1) infinite}
@keyframes tpblink{50%{opacity:0}}
.kit-terminal .tp-h2 h2{font-size:34px}.kit-terminal .tp-stat b{font-size:30px}
.kit-terminal .tp-btn{background:transparent;color:var(--acc);border:1px solid var(--acc);height:40px}
.kit-terminal .tp-btn:not(.ghost){background:var(--acc);color:var(--on)}
.kit-terminal .tp-stat,.kit-terminal .tp-card{border:1px solid rgba(216,255,230,.22);background:rgba(10,20,15,.6)}
.kit-terminal .tp-card:hover{border-color:var(--acc)}
.kit-terminal .tp-bar s{background:repeating-linear-gradient(90deg,var(--acc) 0 6px,transparent 6px 8px)}`,
  newsprint: `
.tp.kit-newsprint{background:#f3eee2;color:#1b1a17;font-family:'Libre Franklin',sans-serif}
.kit-newsprint .tp-top{border-bottom:3px double #1b1a17}
.kit-newsprint .tp-hero{text-align:center;border-bottom:1px solid #1b1a17}
.kit-newsprint .tp-hero h1,.kit-newsprint .tp-h2 h2,.kit-newsprint .tp-brand b,.kit-newsprint .tp-stat b{font-family:'Playfair Display',serif;font-weight:900}
.kit-newsprint .tp-hero h1{font-size:clamp(44px,9vw,120px);letter-spacing:-.02em}
.kit-newsprint .tp-hero p{margin-left:auto;margin-right:auto;font-style:italic}
.kit-newsprint .tp-cta{justify-content:center}
.kit-newsprint .tp-btn{background:#1b1a17;color:#f3eee2}
.kit-newsprint .tp-btn:not(.ghost){background:var(--acc);color:var(--on)}
.kit-newsprint .tp-stats{gap:0;border-bottom:1px solid #1b1a17;margin-top:0}
.kit-newsprint .tp-stat{border-right:1px solid #1b1a17;text-align:center}.kit-newsprint .tp-stat:last-child{border:0}
.kit-newsprint .tp-h2{border-bottom:3px solid #1b1a17;padding-bottom:6px}
.kit-newsprint .tp-grid{gap:0;border-left:1px solid #1b1a17}
.kit-newsprint .tp-card{border-right:1px solid #1b1a17;border-bottom:1px solid #1b1a17;background:transparent}
.kit-newsprint .tp-card-top img,.kit-newsprint .tp-card-top i{filter:grayscale(.2) contrast(1.1)}
.kit-newsprint .tp-bar{background:#d7cfbd}`,
  arcade: `
.tp.kit-arcade{background:#140a2b;color:#f2eaff;font-family:'Space Mono',monospace;background-image:radial-gradient(circle at 50% -20%,color-mix(in srgb,var(--acc) 35%,transparent),transparent 60%)}
.kit-arcade .tp-hero h1,.kit-arcade .tp-h2 h2,.kit-arcade .tp-brand b,.kit-arcade .tp-btn,.kit-arcade .tp-stat b{font-family:'Press Start 2P',monospace;font-weight:400}
.kit-arcade .tp-hero{text-align:center}
.kit-arcade .tp-hero h1{font-size:clamp(24px,5.5vw,62px);line-height:1.25;color:#fff;text-shadow:4px 4px 0 var(--acc),8px 8px 0 #000}
.kit-arcade .tp-cta{justify-content:center}
.kit-arcade .tp-brand b{font-size:12px}.kit-arcade .tp-h2 h2{font-size:16px}.kit-arcade .tp-stat b{font-size:14px}
.kit-arcade .tp-btn{font-size:11px;height:44px;box-shadow:4px 4px 0 #000;border:2px solid #fff}
.kit-arcade .tp-btn.ghost{background:#2a1a52;color:#fff}
.kit-arcade .tp-stat,.kit-arcade .tp-card{background:#1f1240;border:3px solid var(--acc);box-shadow:5px 5px 0 #000}
.kit-arcade .tp-bar{height:12px;background:#000;border:2px solid #fff}
.kit-arcade .tp-bar s{background:repeating-linear-gradient(90deg,var(--acc) 0 8px,color-mix(in srgb,var(--acc) 60%,#fff) 8px 10px)}
.kit-arcade .tp-card-top img,.kit-arcade .tp-card-top i,.kit-arcade .tp-logo{image-rendering:pixelated;border:2px solid #fff}`,
  glass: `
.tp.kit-glass{color:#fff;font-family:'Sora',sans-serif;background:radial-gradient(circle at 10% 20%,var(--acc) 0,transparent 42%),radial-gradient(circle at 90% 10%,#5b6cff 0,transparent 40%),radial-gradient(circle at 70% 90%,#00c2a8 0,transparent 45%),#0d0f1e}
.kit-glass .tp-hero h1,.kit-glass .tp-h2 h2{font-weight:800;letter-spacing:-.03em}
.kit-glass .tp-hero h1{font-size:clamp(40px,8vw,96px)}
.kit-glass .tp-btn{border-radius:14px}
.kit-glass .tp-btn.ghost{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3);backdrop-filter:blur(10px)}
.kit-glass .tp-stat,.kit-glass .tp-card{border-radius:20px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.kit-glass .tp-logo,.kit-glass .tp-card-top img,.kit-glass .tp-card-top i{border-radius:14px}
.kit-glass .tp-bar{border-radius:9px;background:rgba(255,255,255,.15)}.kit-glass .tp-bar s{border-radius:9px}`,
  brutal: `
.tp.kit-brutal{background:#fff;color:#000;font-family:'Archivo',sans-serif}
.kit-brutal .tp-hero h1,.kit-brutal .tp-h2 h2,.kit-brutal .tp-brand b,.kit-brutal .tp-stat b,.kit-brutal .tp-btn{font-family:'Archivo Black',sans-serif;font-weight:400;text-transform:uppercase}
.kit-brutal .tp-hero h1{font-size:clamp(46px,10vw,132px);letter-spacing:-.04em;line-height:.9}
.kit-brutal .tp-hero h1 span{background:var(--acc);color:var(--on);padding:0 .08em}
.kit-brutal .tp-btn{border:3px solid #000;box-shadow:5px 5px 0 #000;height:48px}
.kit-brutal .tp-btn.ghost{background:#fff;color:#000}
.kit-brutal .tp-stat,.kit-brutal .tp-card{border:3px solid #000;box-shadow:6px 6px 0 #000;background:#fff}
.kit-brutal .tp-stat:nth-child(2){background:var(--acc);color:var(--on)}
.kit-brutal .tp-card:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 #000}
.kit-brutal .tp-bar{height:14px;border:3px solid #000;background:#fff}
.kit-brutal .tp-card-top img,.kit-brutal .tp-card-top i,.kit-brutal .tp-logo{border:3px solid #000}`,
  soft: `
.tp.kit-soft{background:#fff6f0;color:#3a2f3f;font-family:'Nunito',sans-serif;background-image:radial-gradient(circle at 85% 12%,var(--acc3) 0,transparent 24%),radial-gradient(circle at 8% 70%,#d8f3ea 0,transparent 26%),radial-gradient(circle at 60% 95%,#fde7b0 0,transparent 22%)}
.kit-soft .tp-hero h1,.kit-soft .tp-h2 h2,.kit-soft .tp-brand b,.kit-soft .tp-stat b,.kit-soft .tp-btn{font-family:'Fredoka',sans-serif;font-weight:700}
.kit-soft .tp-hero h1{font-size:clamp(42px,8vw,98px);color:#3a2f3f}
.kit-soft .tp-btn{border-radius:999px;height:48px;padding:0 24px;box-shadow:0 8px 20px color-mix(in srgb,var(--acc) 35%,transparent)}
.kit-soft .tp-btn.ghost{background:#fff;border:0;color:#3a2f3f}
.kit-soft .tp-stat,.kit-soft .tp-card{border-radius:28px;background:#fff;box-shadow:0 12px 30px rgba(120,80,110,.1)}
.kit-soft .tp-logo,.kit-soft .tp-card-top img,.kit-soft .tp-card-top i{border-radius:50%}
.kit-soft .tp-bar{height:12px;border-radius:12px;background:#f3e6ee}.kit-soft .tp-bar s{border-radius:12px}`,
  street: `
.tp.kit-street{background:#161616;color:#f5f5f0;font-family:'Barlow',sans-serif;background-image:repeating-linear-gradient(-45deg,transparent 0 40px,rgba(255,255,255,.02) 40px 80px)}
.kit-street .tp-top{border-bottom:14px solid transparent;border-image:repeating-linear-gradient(-45deg,var(--acc) 0 18px,#111 18px 36px) 14}
.kit-street .tp-hero h1,.kit-street .tp-h2 h2,.kit-street .tp-brand b,.kit-street .tp-stat b,.kit-street .tp-btn{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em}
.kit-street .tp-hero h1{font-size:clamp(56px,12vw,160px);line-height:.88}
.kit-street .tp-hero p{display:inline-block;background:#f5f5f0;color:#111;padding:4px 10px;transform:rotate(-1.5deg);opacity:1;font-weight:600}
.kit-street .tp-btn{transform:rotate(-1deg);height:50px;font-size:20px}
.kit-street .tp-btn.ghost{background:#f5f5f0;color:#111;border:0;transform:rotate(1deg)}
.kit-street .tp-stat,.kit-street .tp-card{background:#222;border-left:6px solid var(--acc)}
.kit-street .tp-card:nth-child(odd){transform:rotate(-.6deg)}.kit-street .tp-card:nth-child(even){transform:rotate(.6deg)}
.kit-street .tp-bar{height:10px;background:#333}
.kit-street .tp-bar s{background:repeating-linear-gradient(-45deg,var(--acc) 0 8px,#111 8px 16px)}`
};

export function kitCSS(kitId, color) {
  const acc = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#ff2d87';
  const vars = `.tp{--acc:${acc};--on:${onColor(acc)};--acc2:${mix(acc, '#ffffff', 0.35)};--acc3:${mix(acc, '#ffffff', 0.72)}}`;
  return BASE + (CSS[kitId] || CSS.y2k) + vars;
}
export const fontLink = kitId => `https://fonts.googleapis.com/css2?${kitById(kitId).fonts}&display=swap`;

const fmtEth = v => v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3);

/* brand: { name, tagline, kit, color, logo, x, telegram, website }. data: { tokens: [{ token, name, symbol, image, mcapEth, progress }], stats: { tokens, feesEth, ownerFee, creatorFee, launchFee, curve } } */
export function padMarkup(brand, data = {}, opts = {}) {
  const b = brand || {}, s = data.stats || {}, tokens = data.tokens || [];
  const logo = b.logo ? `<img class="tp-logo" src="${esc(b.logo)}" alt="">` : `<span class="tp-logo">${esc((b.name || 'P').slice(0, 1).toUpperCase())}</span>`;
  const name = esc(b.name || 'Your pad');
  const title = b.kit === 'brutal' ? name.replace(/^(\S+)/, '<span>$1</span>') : name;
  const links = [['x', 'X'], ['telegram', 'Telegram'], ['website', 'Site']].filter(([k]) => b[k]).map(([k, l]) => `<a class="tp-btn ghost" href="${esc(b[k])}" target="_blank" rel="noopener">${l}</a>`).join('');
  const cards = tokens.length ? tokens.map(t => `
    <button class="tp-card" data-token="${esc(t.token)}">
      <div class="tp-card-top">${t.image ? `<img src="${esc(t.image)}" alt="">` : `<i>${esc((t.symbol || '?').slice(0, 1))}</i>`}<div><b>${esc(t.name)}</b><small>$${esc(t.symbol)}</small></div></div>
      <div class="tp-row"><span>Market cap</span><b>${t.mcapEth != null ? fmtEth(t.mcapEth) + ' ETH' : '·'}</b></div>
      <div class="tp-bar"><s style="width:${Math.min(100, Math.max(2, (t.progress || 0) * 100)).toFixed(1)}%"></s></div>
      <div class="tp-row"><span>Curve</span><span>${Math.min(100, (t.progress || 0) * 100).toFixed(0)}%</span></div>
    </button>`).join('') : `<div class="tp-empty">No tokens yet, launch the first one</div>`;
  return `<div class="tp kit-${esc(b.kit || 'y2k')}">
  <div class="tp-wrap">
    <header class="tp-top"><a class="tp-brand" href="${opts.home || '#'}">${logo}<b>${name}</b></a><nav class="tp-nav">${links}<button class="tp-btn" data-act="connect">${esc(opts.connectLabel || 'Connect')}</button></nav></header>
    <section class="tp-hero"><h1>${title}</h1>${b.tagline ? `<p>${esc(b.tagline)}</p>` : ''}<div class="tp-cta"><button class="tp-btn" data-act="launch">Launch a token</button><button class="tp-btn ghost" data-act="tokens">Tokens</button></div></section>
    <section class="tp-stats">
      <div class="tp-stat"><span>Tokens</span><b>${s.tokens ?? tokens.length}</b></div>
      <div class="tp-stat"><span>Fees earned</span><b>${s.feesEth != null ? fmtEth(s.feesEth) + ' ETH' : '0 ETH'}</b></div>
      <div class="tp-stat"><span>Trading fee</span><b>${s.poolFeePct != null ? s.poolFeePct + '%' : '·'}</b></div>
      <div class="tp-stat"><span>Launch fee</span><b>${s.launchFee ? s.launchFee + ' ETH' : 'Free'}</b></div>
    </section>
    <div class="tp-h2" id="tokens"><h2>Tokens</h2><small>${esc(s.curveName || '')}</small></div>
    <section class="tp-grid">${cards}</section>
    <footer class="tp-foot"><span>${name} on Robinhood Chain</span><a href="${opts.trendypad || '/'}" target="_top">Built with Trendypad</a></footer>
  </div>
</div>`;
}

export function padDocument(brand, data, opts = {}) {
  const kit = (brand && brand.kit) || 'y2k';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${fontLink(kit)}"><style>html,body{margin:0;height:100%}${kitCSS(kit, brand && brand.color)}</style></head><body>${padMarkup(brand, data, opts)}</body></html>`;
}

export const SAMPLE_TOKENS = [
  { token: '0x1', name: 'Neon Cat', symbol: 'NCAT', mcapEth: 6.4, progress: 0.42 },
  { token: '0x2', name: 'Paper Frog', symbol: 'PFROG', mcapEth: 2.1, progress: 0.14 },
  { token: '0x3', name: 'Chrome Dog', symbol: 'CDOG', mcapEth: 12.8, progress: 0.81 },
  { token: '0x4', name: 'Pink Moon', symbol: 'PINK', mcapEth: 1.2, progress: 0.03 }
];
