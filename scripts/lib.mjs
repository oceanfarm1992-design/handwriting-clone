// Shared helpers for the repository bots (update, health and security checks). Node 20+, no dependencies.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIBS_FILE = path.join(ROOT, 'js', 'cdn-libs.js');

/** Fetch with a timeout and a couple of retries (CDNs and registries occasionally hiccup). */
export async function get(url, { timeout = 20000, tries = 3, ...init } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'handwriting-clone-bot', ...(init.headers || {}) } });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${last?.message || last}`);
}

export async function sri(url) {
  const res = await get(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `sha384-${createHash('sha384').update(buf).digest('base64')}`;
}

/** The CDN libraries the app loads, read from js/cdn-libs.js. */
export async function readLibs() {
  const mod = await import(`${new URL(`file:///${LIBS_FILE.replace(/\\/g, '/')}`).href}?t=${Date.now()}`);
  return mod.LIBS;
}

/** Split a jsDelivr npm URL into package, version and file path. */
export function parseCdn(url) {
  const m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.+)$/);
  return m ? { pkg: m[1], version: m[2], file: m[3] } : null;
}

/** Every external URL written anywhere in the app's source. */
export function externalUrls() {
  const files = ['index.html', ...fs.readdirSync(path.join(ROOT, 'js')).map((f) => `js/${f}`), ...fs.readdirSync(path.join(ROOT, 'css')).map((f) => `css/${f}`)];
  const out = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) out.push({ file: f, url: m[0] });
  }
  return out;
}

/** Compare dotted versions numerically. */
export function cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Make text that came from the internet (advisory summaries, error messages) safe to put in a
 * Markdown report or issue: one line, no HTML, links, images, mentions or code fences, bounded length.
 */
export function clean(text, max = 200) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[<>[\]()`*_|#@!\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Print a report, and add it to the GitHub Actions job summary when running there. */
export function summary(md) {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

/** True when the URL points at exactly this host (not a look-alike that merely contains it). */
export function isHost(url, host) {
  try {
    return new URL(url).hostname === host;
  } catch {
    return false;
  }
}
