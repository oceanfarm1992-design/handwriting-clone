// Read text out of .txt / .md / .docx / .pdf files. Heavy libraries load on demand from a CDN.
// Tables are converted to pipe rows ("| a | b |"), which the renderer draws as hand-ruled tables.

import { LIBS } from './cdn-libs.js';

const loading = new Map();
/** Load a library from LIBS (checked against its integrity hash) or a plain URL. */
export function loadScript(lib) {
  const { url, integrity } = typeof lib === 'string' ? { url: lib } : lib;
  if (!loading.has(url)) {
    loading.set(
      url,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        if (integrity) {
          s.integrity = integrity;
          s.crossOrigin = 'anonymous';
        }
        s.onload = resolve;
        s.onerror = () => {
          loading.delete(url);
          s.remove();
          reject(new Error('Could not load a required library. Check your internet connection.'));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return loading.get(url);
}

export async function loadJsPdf() {
  await loadScript(LIBS.jspdf);
  return window.jspdf.jsPDF;
}

const clean = (s) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
const pipeRow = (cells) => `| ${cells.join(' | ')} |`;

/** Text of an element, with bold/underlined runs marked __like this__ (drawn as pen underlines). */
function inline(node) {
  const walk = (n) => {
    let s = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.textContent;
      else if (c.nodeType === 1) {
        const t = c.tagName.toLowerCase();
        const inner = walk(c);
        s += ['strong', 'b', 'u'].includes(t) && inner.trim() ? ` __${inner.trim()}__ ` : t === 'br' ? ' ' : inner;
      }
    }
    return s;
  };
  return walk(node).replace(/\s+/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
}

/** Convert mammoth's HTML into plain text with pipe tables, lists, # headings and __underlines__. */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };
  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'table') {
        blank();
        for (const tr of el.querySelectorAll('tr')) {
          const cells = [...tr.children].filter((c) => /^t[dh]$/i.test(c.tagName)).map((c) => clean(c.textContent));
          if (cells.length) out.push(pipeRow(cells));
        }
        blank();
      } else if (tag === 'ul' || tag === 'ol') {
        [...el.children].forEach((li, i) => out.push(`${tag === 'ol' ? `${i + 1}.` : '-'} ${inline(li)}`));
        blank();
      } else if (/^h[1-6]$/.test(tag)) {
        const t = clean(el.textContent);
        if (t) out.push(`# ${t}`, '');
      } else if (tag === 'p') {
        const t = inline(el);
        if (t) out.push(t);
        out.push('');
      } else {
        walk(el);
      }
    }
  };
  walk(doc.body);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function readDocx(file) {
  await loadScript(LIBS.mammoth);
  const { value } = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return htmlToText(value);
}

/**
 * Group PDF text items into visual lines, split each line into cells wherever there is a wide
 * gap, then turn runs of 2+ multi-cell lines into pipe tables aligned to shared column starts.
 */
export function pdfItemsToText(items) {
  const rows = [];
  const sorted = items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ str: i.str, x: i.x, y: i.y, w: i.w, h: i.h || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.h * 0.4));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.cells = [];
    let prevEnd = null;
    for (const it of r.items) {
      const gap = prevEnd === null ? 0 : it.x - prevEnd;
      if (prevEnd !== null && gap < it.h * 1.2) {
        const c = r.cells[r.cells.length - 1];
        c.text += (gap > it.h * 0.15 ? ' ' : '') + it.str;
      } else {
        r.cells.push({ x: it.x, text: it.str });
      }
      prevEnd = it.x + it.w;
    }
  }

  const out = [];
  let prevY = null;
  for (let i = 0; i < rows.length; ) {
    if (rows[i].cells.length >= 2) {
      let j = i;
      while (j < rows.length && rows[j].cells.length >= 2 && (j === i || rows[j - 1].y - rows[j].y < rows[j].h * 3.2)) j++;
      if (j - i >= 2) {
        const block = rows.slice(i, j);
        const tol = Math.max(6, block[0].h * 0.8);
        const starts = [];
        for (const x of block.flatMap((r) => r.cells.map((c) => c.x)).sort((a, b) => a - b)) {
          if (!starts.length || x - starts[starts.length - 1] > tol) starts.push(x);
        }
        if (prevY !== null) out.push('');
        for (const r of block) {
          const cells = new Array(starts.length).fill('');
          for (const c of r.cells) {
            let idx = 0;
            while (idx + 1 < starts.length && c.x >= starts[idx + 1] - tol) idx++;
            cells[idx] = (cells[idx] ? cells[idx] + ' ' : '') + clean(c.text);
          }
          out.push(pipeRow(cells));
        }
        out.push('');
        prevY = rows[j - 1].y;
        i = j;
        continue;
      }
    }
    const r = rows[i];
    if (prevY !== null && prevY - r.y > r.h * 2.6 && out[out.length - 1] !== '') out.push('');
    out.push(r.cells.map((c) => c.text).join('  '));
    prevY = r.y;
    i++;
  }
  return out.join('\n');
}

/** Download a CDN file and refuse it unless its SHA-384 matches the pinned integrity hash. */
async function fetchVerified(lib) {
  const res = await fetch(lib.url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error('Could not load a required library. Check your internet connection.');
  const buf = await res.arrayBuffer();
  const [alg, want] = lib.integrity.split(/-(.+)/);
  const digest = await crypto.subtle.digest(alg.replace('sha', 'SHA-'), buf);
  let bin = '';
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  if (btoa(bin) !== want) throw new Error('A required library failed its integrity check, so it was not run.');
  return new Blob([buf], { type: 'text/javascript' });
}

const modules = new Map();
/** import() cannot check integrity hashes, so verify the module first and import it from a blob. */
function importVerified(lib) {
  if (!modules.has(lib.url)) {
    const p = fetchVerified(lib).then(async (blob) => {
      const url = URL.createObjectURL(blob);
      try {
        return await import(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    });
    p.catch(() => modules.delete(lib.url));
    modules.set(lib.url, p);
  }
  return modules.get(lib.url);
}

let pdfWorker = null;
export async function loadPdfJs() {
  const pdfjs = await importVerified(LIBS.pdfjs);
  if (!pdfWorker) {
    // the worker is verified the same way and started from the checked copy
    const blob = await fetchVerified(LIBS.pdfjsWorker);
    pdfWorker = new Worker(URL.createObjectURL(blob), { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = pdfWorker;
  }
  return pdfjs;
}

async function readPdf(file) {
  const pdfjs = await loadPdfJs();
  // isEvalSupported: false — never compile code from inside a PDF (defence in depth for CVE-2024-4367)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const items = content.items
      .filter((i) => 'str' in i)
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height }));
    pages.push(pdfItemsToText(items));
  }
  return pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function importText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return readDocx(file);
  if (name.endsWith('.pdf')) return readPdf(file);
  if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save the file as .docx and try again.');
  return file.text();
}
