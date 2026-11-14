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
5. **Export.** Download a PDF or individual PNG pages.

## Try it

Open the live app and press **Try demo handwriting**. It fabricates a crooked, unevenly lit photo of a filled-in template using a script font and runs it through the full pipeline.

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

## Responsible use

Use your own handwriting, or handwriting you have clear permission to copy. Do not use this to forge signatures, impersonate others, or submit work in a way your school or employer forbids. Handwriting is personal data: samples stay in your browser, and **Remove my handwriting** deletes the saved copy.

## Licence

[MIT](LICENSE)
