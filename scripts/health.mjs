// Health bot: is everything the app depends on still there and working?
//
//   node scripts/health.mjs [--site https://user.github.io/repo/] [--report report.md]
//
// 1. every JavaScript file parses
// 2. every CDN library is reachable and still matches its integrity hash
// 3. every sample-handwriting font still resolves on Google Fonts
// 4. (with --site) the live site and every file it loads respond, and it serves the current code
// Exits 1 when something is broken. Warnings do not fail the run.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readLibs, get, sri, summary } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const SITE = opt('--site');
const REPORT = opt('--report');

const fails = [];
const warns = [];
const passes = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    passes.push(note ? `${name}: ${note}` : name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
  }
};

// 1. syntax
const jsFiles = [...fs.readdirSync(path.join(ROOT, 'js')).map((f) => `js/${f}`), ...fs.readdirSync(path.join(ROOT, 'scripts')).map((f) => `scripts/${f}`)].filter((f) => /\.m?js$/.test(f));
await check(`${jsFiles.length} JavaScript files parse`, () => {
  const bad = jsFiles.filter((f) => spawnSync(process.execPath, ['--check', path.join(ROOT, f)]).status !== 0);
  if (bad.length) throw new Error(`syntax errors in ${bad.join(', ')}`);
});

// 2. CDN libraries
const libs = await readLibs();
for (const [key, lib] of Object.entries(libs)) {
  await check(`CDN ${key}`, async () => {
    if (lib.integrity) {
      const got = await sri(lib.url);
      if (got !== lib.integrity) throw new Error(`file changed on the CDN; integrity is ${got}, expected ${lib.integrity}`);
      return 'reachable, integrity matches';
    }
    const res = await get(lib.url, { method: 'HEAD' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return 'reachable';
  });
}

// 3. sample handwriting fonts (only present once the sample picker is in the code)
const demo = await import(new URL(`file:///${path.join(ROOT, 'js', 'demo.js').replace(/\\/g, '/')}`).href);
for (const st of (demo.SAMPLE_STYLES || []).filter((s) => s.google)) {
  await check(`Font "${st.google}"`, async () => {
    const res = await get(`https://fonts.googleapis.com/css2?family=${st.google.replace(/ /g, '+')}&display=swap`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' },
    });
    if (!res.ok) throw new Error(`Google Fonts returned HTTP ${res.status}`);
    const css = await res.text();
    const font = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/);
    if (!font) throw new Error('no font file in the stylesheet');
    const f = await get(font[1], { method: 'HEAD' });
    if (!f.ok) throw new Error(`font file HTTP ${f.status}`);
  });
}

// 4. live site
if (SITE) {
  const base = SITE.endsWith('/') ? SITE : `${SITE}/`;
  const norm = (buf) => createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
  await check('Live site and the files it loads', async () => {
    const res = await get(base);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes('<title>Handwriting Clone</title>')) throw new Error('page does not look like the app');
    // follow what the LIVE page actually loads: its assets, then the modules those import
    const queue = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#|mailto:)([^"]+)"/g)].map((m) => m[1]);
    const seen = new Set();
    const missing = [];
    while (queue.length) {
      const a = queue.shift();
      if (seen.has(a)) continue;
      seen.add(a);
      const r = await get(new URL(a, base).href);
      if (!r.ok) {
        missing.push(`${a} (HTTP ${r.status})`);
        continue;
      }
      if (a.endsWith('.js')) {
        const text = await r.text();
        for (const m of text.matchAll(/(?:import|from)\s*\(?\s*['"](\.\/[^'"]+)['"]/g)) queue.push(new URL(m[1], new URL(a, 'http://x/')).pathname.slice(1));
      }
    }
    if (missing.length) throw new Error(`the live page loads files that are missing: ${missing.join(', ')}`);
    return `${seen.size} files served`;
  });
  await check('Live site matches this commit', async () => {
    const stale = [];
    for (const f of ['index.html', 'css/style.css', ...jsFiles.filter((x) => x.startsWith('js/'))]) {
      const res = await get(new URL(f, base).href);
      const local = norm(fs.readFileSync(path.join(ROOT, f)));
      if (!res.ok || norm(Buffer.from(await res.arrayBuffer())) !== local) stale.push(f);
    }
    if (stale.length) {
      warns.push(`The live site is not serving this commit's version of ${stale.join(', ')}. Normal for a few minutes after a merge; if it lasts, check the Pages deployment.`);
      return 'not yet (see warning)';
    }
    return 'yes';
  });
}

const md = [
  `## Health check: ${fails.length ? `${fails.length} problem${fails.length > 1 ? 's' : ''}` : 'all good'}`,
  '',
  ...fails.map((f) => `- ❌ ${f}`),
  ...warns.map((w) => `- ⚠️ ${w}`),
  ...passes.map((p) => `- ✅ ${p}`),
].join('\n');
summary(md);
if (REPORT) fs.writeFileSync(REPORT, `${md}\n`);
process.exit(fails.length ? 1 : 0);
