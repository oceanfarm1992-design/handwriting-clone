// Libraries the app loads on demand from the jsDelivr CDN, pinned to exact versions.
// PDF.js uses its "legacy" build: same release and security fixes, but it also runs in
// browsers a few years old, not just the newest ones.
// `integrity` is the SHA-384 of the exact file reviewed here: the browser (or, for ES modules,
// js/importers.js) refuses to run a file that differs. `module: true` marks ES module builds.
// Kept up to date by the monthly update bot (scripts/update-cdn.mjs), which recomputes the hashes.
export const LIBS = {
  mammoth: {
    url: 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
    integrity: 'sha384-8NWE3bZDrmRI4IePMoQaEoLhAQ1MmRMJkdNgnGiHRFanTqsFKr0TmK6aSZvFJ/PO',
  },
  pdfjs: {
    url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs',
    integrity: 'sha384-oPqHr8MeYfJpkh4zgHbWYiuwabTzthRiOS5tSWsWGmCVWlwqIkS9coGro5aa48OF',
    module: true,
  },
  pdfjsWorker: {
    url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.worker.min.mjs',
    integrity: 'sha384-tINN5IYq7dFaoHBUBBc2yfxGwR38mZn9GhaX31UofKYNgAg/3y8A7IjUI3GuEg/8',
    module: true,
  },
  jspdf: {
    url: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
    integrity: 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3',
  },
};
