// Libraries the app loads on demand from the jsDelivr CDN, pinned to exact versions.
// `integrity` is the SHA-384 of the exact file reviewed here: the browser (or, for ES modules,
// js/importers.js) refuses to run a file that differs. `module: true` marks ES module builds.
// Kept up to date by the monthly update bot (scripts/update-cdn.mjs), which recomputes the hashes.
export const LIBS = {
  mammoth: {
    url: 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
    integrity: 'sha384-8NWE3bZDrmRI4IePMoQaEoLhAQ1MmRMJkdNgnGiHRFanTqsFKr0TmK6aSZvFJ/PO',
  },
  pdfjs: {
    url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs',
    integrity: 'sha384-QCvhu/UPp22U/TNLVbQNONL82ES2yY717GAiqP9VVu37Y7+m9VPKvadGx9XlFvcp',
    module: true,
  },
  pdfjsWorker: {
    url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs',
    integrity: 'sha384-NfW/OTMWezITv4oaALvfH7MFLwzPxEvpySmDpoALa1mtTY8MC200l0ZNFD+SOlrM',
    module: true,
  },
  jspdf: {
    url: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
    integrity: 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3',
  },
};
