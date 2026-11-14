// Read text out of .txt / .md / .docx / .pdf files. Heavy libraries load on demand from a CDN.

const LIBS = {
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
};

const loading = new Map();
export function loadScript(url) {
  if (!loading.has(url)) {
    loading.set(
      url,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = () => {
          loading.delete(url);
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

async function readDocx(file) {
  await loadScript(LIBS.mammoth);
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

async function readPdf(file) {
  await loadScript(LIBS.pdfjs);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let lastY = null;
    let lastH = 12;
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5];
      const h = item.height || lastH;
      if (lastY !== null && Math.abs(y - lastY) > h * 0.5) {
        out.push(line);
        if (Math.abs(y - lastY) > h * 2.6) out.push('');
        line = '';
      }
      line += item.str;
      if (item.hasEOL) {
        out.push(line);
        line = '';
      }
      lastY = y;
      lastH = h;
    }
    if (line) out.push(line);
    out.push('');
  }
  return out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function importText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return readDocx(file);
  if (name.endsWith('.pdf')) return readPdf(file);
  if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save the file as .docx and try again.');
  return file.text();
}
