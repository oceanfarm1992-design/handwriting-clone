// Security bot: checks that fit a static, browser-only app.
//
//   node scripts/security.mjs [--report report.md]
//
// 1. known vulnerabilities in the CDN libraries (OSV.dev database), minus advisories that were
//    reviewed and accepted in security/accepted-advisories.json (each has a reason and a review date)
// 2. every external URL goes to an approved host, and every CDN URL is pinned to an exact version
// 3. every CDN script carries an integrity hash that matches the file actually served
// 4. no secrets (keys, tokens, private keys) in tracked files
// 5. no personal handwriting (photos, scans, profiles) committed to this public repository
// 6. no eval-style code in the app
// Exits 1 on any failure.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readLibs, parseCdn, externalUrls, get, sri, summary } from './lib.mjs';

const REPORT = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : null;
const ALLOWED_HOSTS = new Set([
  'cdn.jsdelivr.net', // pinned libraries, integrity-checked
  'fonts.googleapis.com', // sample handwriting fonts (stylesheet)
  'fonts.gstatic.com', // sample handwriting fonts (files)
  'www.w3.org', // XML namespace inside the inline SVG icon, never fetched
]);

const fails = [];
const warns = [];
const passes = [];

// ---- 1. vulnerabilities
const libs = await readLibs();
const pkgs = new Map();
for (const lib of Object.values(libs)) {
  const c = parseCdn(lib.url);
  if (c) pkgs.set(`${c.pkg}@${c.version}`, c);
}
const acceptedFile = path.join(ROOT, 'security', 'accepted-advisories.json');
const accepted = fs.existsSync(acceptedFile) ? JSON.parse(fs.readFileSync(acceptedFile, 'utf8')) : [];
const today = new Date().toISOString().slice(0, 10);
for (const a of accepted) {
  if (a.reviewBy < today) fails.push(`Accepted advisory ${a.id} (${a.package}) is past its review date ${a.reviewBy}. Re-check it and update security/accepted-advisories.json.`);
}
for (const { pkg, version } of pkgs.values()) {
  const res = await get('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { name: pkg, ecosystem: 'npm' }, version }),
  });
  if (!res.ok) {
    fails.push(`OSV lookup for ${pkg}@${version} failed: HTTP ${res.status}`);
    continue;
  }
  const vulns = (await res.json()).vulns || [];
  const open = [];
  for (const v of vulns) {
    const ids = [v.id, ...(v.aliases || [])];
    const ok = accepted.find((a) => a.package === pkg && ids.includes(a.id) && (!a.version || a.version === version));
    if (ok) warns.push(`${pkg}@${version}: ${v.id} accepted until ${ok.reviewBy} (${ok.reason})`);
    else open.push(`${v.id}${v.aliases?.length ? ` (${v.aliases.join(', ')})` : ''}: ${v.summary || 'no summary'}`);
  }
  if (open.length) fails.push(`${pkg}@${version} has known vulnerabilities:\n  - ${open.join('\n  - ')}`);
  else passes.push(`${pkg}@${version}: no open known vulnerabilities`);
}

// ---- 2. external URLs
const urls = externalUrls();
const badHost = urls.filter(({ url }) => !ALLOWED_HOSTS.has(new URL(url).hostname));
if (badHost.length) fails.push(`External URLs to hosts that are not approved:\n  - ${badHost.map((u) => `${u.file}: ${u.url}`).join('\n  - ')}`);
const unpinned = urls.filter(({ url }) => url.includes('cdn.jsdelivr.net/') && !/@\d+\.\d+\.\d+\//.test(url));
if (unpinned.length) fails.push(`CDN URLs without an exact version:\n  - ${unpinned.map((u) => `${u.file}: ${u.url}`).join('\n  - ')}`);
if (!badHost.length && !unpinned.length) passes.push(`${urls.length} external URLs: approved hosts, CDN versions pinned`);

// ---- 3. integrity hashes
for (const [key, lib] of Object.entries(libs)) {
  if (!lib.integrity) {
    fails.push(`${key} is loaded without an integrity hash`);
    continue;
  }
  const got = await sri(lib.url);
  if (got !== lib.integrity) fails.push(`${key}: the CDN now serves a different file than the one pinned (integrity ${got})`);
  else passes.push(`${key}: integrity hash matches`);
}
const looseScripts = urls.filter(({ file, url }) => file !== 'js/cdn-libs.js' && url.includes('cdn.jsdelivr.net/'));
if (looseScripts.length) fails.push(`CDN URLs outside js/cdn-libs.js (they bypass integrity checks):\n  - ${looseScripts.map((u) => `${u.file}: ${u.url}`).join('\n  - ')}`);

// ---- 4. secrets
const tracked = execSync('git ls-files -z', { cwd: ROOT }).toString().split('\0').filter(Boolean);
const SECRET_PATTERNS = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/],
  ['Anthropic or OpenAI key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
];
const secretHits = [];
for (const f of tracked) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full) || fs.statSync(full).size > 2e6) continue;
  const text = fs.readFileSync(full, 'utf8');
  for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) secretHits.push(`${f}: looks like a ${name}`);
}
if (secretHits.length) fails.push(`Possible secrets committed:\n  - ${secretHits.join('\n  - ')}`);
else passes.push(`${tracked.length} tracked files: no secrets found`);

// ---- 5. personal handwriting must never be published
const personal = tracked.filter(
  (f) => f.startsWith('my-handwriting/') || /\.(jpe?g|png|heic|webp|gif|bmp|tiff?)$/i.test(f) ||
    (f.endsWith('.json') && /"app"\s*:\s*"handwriting-clone"/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))),
);
if (personal.length) fails.push(`Files that may hold someone's handwriting are committed to this public repository:\n  - ${personal.join('\n  - ')}`);
else passes.push('No handwriting photos, scans or profiles committed');

// ---- 6. eval-style code
const evalHits = [];
for (const f of tracked.filter((x) => x.startsWith('js/'))) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [name, re] of [['eval()', /\beval\s*\(/], ['new Function()', /\bnew\s+Function\s*\(/], ['document.write()', /document\.write\s*\(/]]) {
    if (re.test(text)) evalHits.push(`${f}: ${name}`);
  }
}
if (evalHits.length) fails.push(`Code that runs strings as code:\n  - ${evalHits.join('\n  - ')}`);
else passes.push('No eval-style code in js/');

const md = [
  `## Security check: ${fails.length ? `${fails.length} problem${fails.length > 1 ? 's' : ''}` : 'all good'}`,
  '',
  ...fails.map((f) => `- ❌ ${f}`),
  ...warns.map((w) => `- ⚠️ ${w}`),
  ...passes.map((p) => `- ✅ ${p}`),
].join('\n');
summary(md);
if (REPORT) fs.writeFileSync(REPORT, `${md}\n`);
process.exit(fails.length ? 1 : 0);
