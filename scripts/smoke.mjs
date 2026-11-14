// Browser smoke test: open the app in headless Chromium and use it like a person would.
//
//   npm install --no-save playwright@1.64.1 && npx playwright install chromium
//   node scripts/smoke.mjs [--report report.md]
//
// Serves the repository locally, loads a sample handwriting, checks all 82 characters are captured,
// that a page renders, that the CDN libraries load in a real browser with their integrity hashes,
// and that nothing was logged as an error.
import http from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, summary, clean } from './lib.mjs';

const REPORT = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : null;
// resolve Playwright from the directory the test is run in (CI installs it there without saving it)
const { chromium } = createRequire(path.join(process.cwd(), 'noop.js'))('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const steps = [];
const errors = [];
const browser = await chromium.launch();
const browserVersion = browser.version();
let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  const step = async (name, fn) => {
    try {
      const note = await fn();
      steps.push(`✅ ${name}${note ? `: ${note}` : ''}`);
    } catch (e) {
      failed = true;
      steps.push(`❌ ${name}: ${clean(e.message.split('\n')[0], 400)}`);
    }
  };

  await step('App loads', async () => {
    await page.goto(url);
    await page.waitForSelector('#demoBtn');
  });
  await step('Sample handwriting captures all characters', async () => {
    if (await page.$('#sampleSelect')) await page.selectOption('#sampleSelect', 'system'); // offline sample
    await page.click('#demoBtn');
    await page.waitForFunction(() => /82 of 82/.test(document.getElementById('glyphSummary').textContent), null, { timeout: 30000 });
    return (await page.textContent('#glyphSummary')).replace(/\. Click.*/, '');
  });
  await step('A handwritten page renders', async () => {
    await page.waitForSelector('#pages canvas', { timeout: 15000 });
    const n = await page.$$eval('#pages canvas', (cs) => cs.length);
    const inked = await page.$eval('#pages canvas', (c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] < 300) dark++;
      return dark;
    });
    if (inked < 500) throw new Error('page is blank');
    return `${n} page(s)`;
  });
  await step('CDN libraries load with integrity checks', async () => {
    const r = await page.evaluate(async () => {
      const m = await import('./js/importers.js');
      const { LIBS } = await import('./js/cdn-libs.js');
      const J = await m.loadJsPdf();
      await m.loadScript(LIBS.mammoth);
      const pdfjs = await m.loadPdfJs();
      return [typeof J, typeof window.mammoth?.convertToHtml, typeof pdfjs.getDocument];
    });
    if (r.some((t) => t !== 'function')) throw new Error(`unexpected: ${r.join(', ')}`);
    return 'jsPDF, mammoth, PDF.js';
  });
  await step('Round trip: make a PDF and read its text back', async () => {
    const text = await page.evaluate(async () => {
      const m = await import('./js/importers.js');
      const J = await m.loadJsPdf();
      const pdf = new J();
      pdf.text('Health check 42', 20, 30);
      return m.importText(new File([pdf.output('arraybuffer')], 'check.pdf'));
    });
    if (!text.includes('Health check 42')) throw new Error(`read back "${text}"`);
  });
  await step('No errors in the console', async () => {
    if (errors.length) throw new Error(errors.slice(0, 5).join(' | '));
  });
} finally {
  await browser.close();
  server.close();
}

const md = [`## Browser smoke test (Chromium ${browserVersion}): ${failed ? 'failed' : 'passed'}`, '', ...steps.map((s) => `- ${s}`)].join('\n');
summary(md);
if (REPORT) fs.writeFileSync(REPORT, `${md}\n`);
process.exit(failed ? 1 : 0);
