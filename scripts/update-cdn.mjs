// Update bot: keeps the CDN libraries in js/cdn-libs.js current.
//
//   node scripts/update-cdn.mjs [--check] [--report report.md] [--min-age-days 14]
//
// Takes the newest release in the SAME major version that has been public for at least
// --min-age-days (a fresh release could be a hijacked one), checks every file the app uses
// exists in it, recomputes integrity hashes and rewrites js/cdn-libs.js. New MAJOR versions are
// only reported, because they can change file layouts and APIs and need a person to test them.
// With --check nothing is written. Sets the GitHub output `changed`.
import fs from 'node:fs';
import { LIBS_FILE, readLibs, parseCdn, get, sri, cmpVersion, summary } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const CHECK = args.includes('--check');
const MIN_AGE_DAYS = Number(opt('--min-age-days', 14));
const REPORT = opt('--report', null);

const libs = await readLibs();
const byPkg = new Map();
for (const [key, lib] of Object.entries(libs)) {
  const c = parseCdn(lib.url);
  if (!c) continue;
  if (!byPkg.has(c.pkg)) byPkg.set(c.pkg, { version: c.version, entries: [] });
  byPkg.get(c.pkg).entries.push({ key, ...c, lib });
}

const now = Date.now();
const updates = [];
const majors = [];
const problems = [];
for (const [pkg, { version, entries }] of byPkg) {
  const res = await get(`https://registry.npmjs.org/${pkg.replace('/', '%2f')}`);
  if (!res.ok) {
    problems.push(`${pkg}: registry returned HTTP ${res.status}`);
    continue;
  }
  const doc = await res.json();
  const major = version.split('.')[0];
  const stable = Object.keys(doc.versions || {}).filter((v) => /^\d+\.\d+\.\d+$/.test(v) && !doc.versions[v].deprecated);
  const oldEnough = (v) => doc.time?.[v] && now - Date.parse(doc.time[v]) >= MIN_AGE_DAYS * 86400e3;
  const sameMajor = stable.filter((v) => v.split('.')[0] === major && cmpVersion(v, version) > 0 && oldEnough(v)).sort(cmpVersion);
  const newerMajor = stable.filter((v) => Number(v.split('.')[0]) > Number(major) && oldEnough(v)).sort(cmpVersion);
  if (newerMajor.length) majors.push({ pkg, version, latest: newerMajor.at(-1) });
  const target = sameMajor.at(-1);
  if (!target) continue;

  // every file must exist in the new version; recompute hashes
  const next = [];
  let ok = true;
  for (const e of entries) {
    const url = e.lib.url.replace(`${pkg}@${version}/`, `${pkg}@${target}/`);
    const head = await get(url, { method: 'HEAD' });
    if (!head.ok) {
      problems.push(`${pkg}@${target}: ${e.file} is missing (HTTP ${head.status}); skipped`);
      ok = false;
      break;
    }
    next.push({ e, url, integrity: e.lib.integrity ? await sri(url) : null });
  }
  if (ok) updates.push({ pkg, from: version, to: target, published: doc.time[target], next });
}

if (updates.length && !CHECK) {
  let text = fs.readFileSync(LIBS_FILE, 'utf8');
  for (const u of updates) {
    for (const { e, url, integrity } of u.next) {
      text = text.replace(e.lib.url, url);
      if (integrity) text = text.replace(e.lib.integrity, integrity);
    }
  }
  fs.writeFileSync(LIBS_FILE, text);
}

const lines = ['## CDN library updates', ''];
if (updates.length) {
  lines.push(CHECK ? 'Available (not applied, check mode):' : 'Applied:', '');
  for (const u of updates) lines.push(`- **${u.pkg}** ${u.from} → ${u.to} (released ${u.published.slice(0, 10)}); integrity hashes recomputed`);
} else lines.push(`All libraries are on the newest release of their major version that is at least ${MIN_AGE_DAYS} days old.`);
if (majors.length) {
  lines.push('', '### New major versions (need a person to test)', '');
  for (const m of majors) lines.push(`- **${m.pkg}** ${m.version} → ${m.latest}`);
}
if (problems.length) lines.push('', '### Problems', '', ...problems.map((p) => `- ${p}`));
const md = lines.join('\n');
summary(md);
if (REPORT) fs.writeFileSync(REPORT, `${md}\n`);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${updates.length && !CHECK ? 'true' : 'false'}\nmajors=${majors.length ? 'true' : 'false'}\n`);
}
