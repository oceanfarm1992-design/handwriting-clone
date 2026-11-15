# Handwriting Clone

Turn a Word, PDF or text document into pages written in **your own handwriting**. Many people study better when their notes look like their own writing; this tool makes that possible for any document.

**Live app: https://oceanfarm1992-design.github.io/handwriting-clone/**

Everything runs in the browser. There is no server and no upload: your handwriting samples stay on your device (optionally saved in your browser's local storage).

## How it works

1. **Learn from a photo (no template).** Photograph a page you already wrote, or copy the built-in practice paragraph onto any paper, and tell the app what the page says. It finds the lines, words and letters, lines them up with your text, and harvests your letters automatically. Samples of the same letter vote out the odd ones, and letters learned from cleanly written words are then used to decode words where letters touch. Your letter and word spacing are learned from the same page.
1. **Write on screen.** Write each character on a pad with a finger, stylus (pressure-sensitive) or mouse. School-style guide lines keep sizes consistent, and you can go back, undo or skip. Then write two short sentences so the app can **learn your letter and word spacing**.
1. **Or use a template.** The app generates a printable A4 sheet with a box for each of 82 characters (a-z, A-Z, 0-9 and common punctuation) and a black registration square in each corner.
2. **Capture from paper.** You write in the boxes, then scan or photograph the sheet. The app finds the four corner squares, corrects perspective and uneven lighting, and cuts out every character as a transparent glyph. Upload two pages to get two variants of every letter.
3. **Import.** Open a `.docx`, text-based `.pdf`, `.txt` or `.md` file, or paste text. Tables are kept: they appear as `| a | b |` rows (editable, or type your own) and are drawn with hand-ruled borders that follow the paper lines.
4. **Render.** Headings and labels like `Meaning :-` get pen underlines, lists get hanging indents, `__words__` are underlined and `~~words~~` scribbled out. The **Study notes look** gives plain white paper with natural line drift, a wandering margin, occasional crossed-out slips and a phone-photo finish. Text is laid out on ruled, grid, dotted or plain paper. Each letter picks a random variant with slight changes in size, tilt, baseline and spacing, so repeated letters never look stamped.
5. **Pen strokes.** Optional: every letter is redrawn as smooth pen strokes. Letters written on screen use the strokes as you wrote them (with pen pressure); scanned and photographed letters are traced into ordered pen paths with the ink width measured along them. Letters stay crisp at any size, joins leave and arrive along the pen's real direction, and each letter is a fresh blend of two of your samples plus a gentle bend, so no two are the same.
5. **Joined writing.** Optional: letters are joined with pen strokes that start where your pen leaves one letter and end where it enters the next (found by thinning each letter to its centre line, so it works for scanned and photographed letters too). Common pairs you write joined on screen (th, he, in…), or that the photo learner finds in your writing, are used as they are. Letters are also gently reshaped so repeats are never identical.
5. **Paper saver.** One, two or three columns, narrow or minimal margins, an optional line between columns, and `==key point==` highlighter marks. The **Paper saver** preset gives dense two-column revision notes.
5. **Layout controls.** Paragraph spacing sets the gap between paragraphs, and a page limit shrinks the writing just enough to fit a maximum number of pages (down to 55% of the chosen size).
5. **Sample checker.** Samples that would print wrongly (a number floating above the line, a "p" without its tail, a capital as small as a lower-case letter, or a sample that looks unlike your other samples of that character) are outlined in red with the reason, left out automatically when a better sample exists, and can be removed in one click.
5. **Pen colours that print true.** Screens can show blues that printers cannot mix; those print lighter and greyer. The app warns when an ink will print differently, offers pen colours that print reliably, and makes an ink test page with your handwriting in a ladder of blues, so you can pick the line that matches your real pen on your printer.
5. **Export.** PDFs and page images are drawn at 300 dpi, so printed letters have clean edges; pages are prepared one at a time with progress, so even long documents export in seconds. Download a PDF or individual PNG pages.

## Try it

Open the live app, pick one of the ten **sample handwritings** and press **Use this sample**. Each sample is an open handwriting font (SIL Open Font License, fetched from Google Fonts when chosen; the first one uses fonts already on your device and works offline). The app draws it into a crooked, unevenly lit fake photo of the template and runs that through the full scan pipeline.

To run locally, serve the folder with any static server (ES modules need `http://`, not `file://`):

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Tests

```bash
node --test
```

The computer-vision helpers in `js/cv.js` (thresholding, connected components, homography, lighting normalisation, corner detection) the spacing learner in `js/spacing.js` and the photo learner in `js/harvest.js` have no DOM dependency and are unit tested with Node's built-in runner.

## Project layout

| File | Purpose |
| --- | --- |
| `js/template.js` | Template geometry and drawing |
| `js/cv.js` | DOM-free image helpers |
| `js/extract.js` | Scan to glyph library |
| `js/render.js` | Layout, paper and glyph painting |
| `js/importers.js` | Word / PDF / text import, jsPDF loader |
| `js/profile.js` | Save and load handwriting profiles |
| `js/demo.js` | Fake scan used by the demo button |
| `js/drawpad.js` | Writing pad and stroke-to-glyph conversion |
| `js/drawui.js` | Write-on-screen and learn-spacing dialog |
| `js/spacing.js` | Learns spacing from a written sentence (DOM-free) |
| `js/harvest.js` | Learns letters from a photo plus its text: segmentation, alignment, voting (DOM-free) |
| `js/photoui.js` | Learn-from-a-photo dialog and practice paragraph |
| `js/main.js` | UI wiring |

PDF.js, mammoth.js and jsPDF are loaded from the jsDelivr CDN on demand.

## Limitations

- Learning from a photo needs most letters written separately and a transcript that matches the page; fully joined cursive cannot be read this way.
- Each character is stored on its own, so connected cursive is not reproduced; letters are placed next to each other with natural variation.
- Only the characters on the template are supported. Accented letters fall back to the plain letter; other symbols are skipped and reported.
- Scanned PDFs without a text layer cannot be read (no OCR yet).
- Hold the page upright when photographing; a page rotated by 90 or 180 degrees is not detected.

## Ideas for contributors

- Style-conditioned neural generation (for example Handwriting Transformers or diffusion-based models) for true cursive
- OCR for scanned PDFs
- Orientation detection for rotated scans
- Preserving bold and headings from Word documents; merged table cells; ruled lines drawn inside PDF tables

## Disclaimer

Handwriting Clone is for **personal study and educational use only**. Use only your own handwriting, or handwriting you have clear permission to use, and only for lawful purposes. Do not use it to forge signatures or documents, impersonate anyone, commit fraud, or break exam, school, workplace or legal rules.

You are solely responsible for how you use it and for what you create with it. The software is provided **"as is", without warranty of any kind**, and the developers and contributors accept no responsibility or liability for any misuse, criminal or unlawful activity, or any loss, damage or legal consequence arising from its use. See [DISCLAIMER.md](DISCLAIMER.md) and the [MIT licence](LICENSE).

Handwriting is personal data: samples stay in your browser, and **Remove my handwriting** deletes the saved copy.

## Repository bots

Three scheduled GitHub Actions keep the project healthy. Each opens an issue when something is wrong and closes it once fixed. See [SECURITY.md](SECURITY.md) for details.

- **Security check** (weekly, and on every pull request): CodeQL, known vulnerabilities in the CDN libraries, pinning and integrity hashes, secrets, and personal handwriting accidentally committed.
- **Health check** (weekly): unit tests, every library and font the app needs, the live site, and a headless-browser smoke test.
- **Update bot** (monthly): updates the CDN libraries (only releases at least 14 days old), re-runs every check, and opens a pull request. Dependabot updates the workflow actions weekly.

Run them locally with `node scripts/security.mjs`, `node scripts/health.mjs --site <url>`, and `node scripts/update-cdn.mjs --check`.

## Licence

[MIT](LICENSE)
