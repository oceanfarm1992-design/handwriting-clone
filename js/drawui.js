// "Write on screen" dialog: capture characters one at a time, or a sentence to learn spacing.
import { CHARS } from './template.js';
import { Pad, PAD, PEN, glyphFromStrokes } from './drawpad.js';
import { SPACING_PHRASES, learnSpacing } from './spacing.js';
import { buildFont } from './render.js';

const $ = (id) => document.getElementById(id);
const SENTENCE_W = 520;

const NAMES = {
  '.': 'full stop', ',': 'comma', ';': 'semicolon', ':': 'colon', '!': 'exclamation mark',
  '?': 'question mark', "'": 'apostrophe', '"': 'double quote', '-': 'hyphen', '(': 'opening bracket',
  ')': 'closing bracket', '/': 'slash', '&': 'ampersand', '@': 'at sign', '%': 'percent sign',
  '+': 'plus', '=': 'equals', '*': 'asterisk', '#': 'hash', '_': 'underscore',
};
function describe(ch) {
  if (/[a-z]/.test(ch)) return 'lowercase letter';
  if (/[A-Z]/.test(ch)) return 'capital letter';
  if (/[0-9]/.test(ch)) return 'number';
  return NAMES[ch] || 'symbol';
}

export function initDrawing({ getGlyphs, addGlyph, removeGlyph, applyLearned, setStatus }) {
  const dlg = $('drawDlg');
  const pad = new Pad($('pad'), () => {
    $('drawUndo').disabled = !pad.strokes.length;
    $('drawClear').disabled = !pad.strokes.length;
  });
  let mode = 'chars';
  let queue = [];
  let idx = 0;
  let added = [];
  let lines = [];

  function show(which) {
    $('drawSetup').hidden = which !== 'setup';
    $('drawMain').hidden = which !== 'main';
  }

  function step() {
    $('drawBack').disabled = idx === 0;
    if (mode === 'chars') {
      const ch = queue[idx];
      $('drawPrompt').textContent = ch;
      $('drawHint').textContent = describe(ch);
      $('drawProgress').textContent = `${idx + 1} of ${queue.length}`;
      $('drawSkip').hidden = false;
      $('drawNext').textContent = idx === queue.length - 1 ? 'Finish' : 'Next';
      pad.load([]);
    } else {
      $('drawPrompt').textContent = SPACING_PHRASES[idx];
      $('drawHint').textContent = 'Write this at your normal size, with normal gaps between words.';
      $('drawProgress').textContent = `Line ${idx + 1} of ${SPACING_PHRASES.length}`;
      $('drawSkip').hidden = true;
      $('drawNext').textContent = idx === SPACING_PHRASES.length - 1 ? 'Learn my spacing' : 'Next line';
      pad.load(lines[idx] || []);
    }
    $('pad').focus();
  }

  function openChars() {
    mode = 'chars';
    $('drawTitle').textContent = 'Write on screen';
    $('drawSetupMsg').textContent = '';
    show('setup');
    dlg.showModal();
  }

  function openSpacing() {
    mode = 'spacing';
    idx = 0;
    lines = [];
    $('drawTitle').textContent = 'Learn my spacing';
    show('main');
    dlg.showModal();
    pad.setLogicalWidth(SENTENCE_W);
    step();
  }

  function start() {
    const have = new Set(getGlyphs().map((g) => g.ch));
    const set = $('drawSet').value;
    queue =
      set === 'missing' ? CHARS.filter((c) => !have.has(c))
      : set === 'lower' ? CHARS.filter((c) => /[a-z]/.test(c))
      : set === 'alnum' ? CHARS.filter((c) => /[a-zA-Z0-9]/.test(c))
      : [...CHARS];
    if (!queue.length) {
      $('drawSetupMsg').textContent = 'You have written every character. Choose "All characters" to add another version of each.';
      return;
    }
    idx = 0;
    added = [];
    show('main');
    pad.setLogicalWidth(PAD.w);
    step();
  }

  function finishChars() {
    dlg.close();
    const n = added.filter(Boolean).length;
    setStatus(n ? `Added ${n} characters written on screen.` : 'No characters were added.', n ? 'ok' : 'info');
  }

  function finishSpacing() {
    const font = buildFont(getGlyphs());
    const inkWidth = (word) => {
      let sum = 0;
      for (const c of word) {
        const gs = font.byChar.get(c);
        if (!gs) return null;
        sum += gs.reduce((a, g) => a + g.inkW * (g.norm || 1), 0) / gs.length / font.xHeight;
      }
      return sum;
    };
    const result = learnSpacing(
      lines.map((strokes, i) => ({ phrase: SPACING_PHRASES[i], strokes })),
      inkWidth,
      PAD.xh,
      PEN / 2,
    );
    if (!result) {
      $('drawHint').textContent = 'The words could not be told apart. Leave a clear gap between words and try again.';
      idx = 0;
      lines = [];
      step();
      return;
    }
    dlg.close();
    applyLearned(result);
  }

  function next() {
    const strokes = pad.strokes.filter((s) => s.length);
    if (mode === 'chars') {
      if (strokes.length) {
        const g = glyphFromStrokes(queue[idx], strokes);
        added[idx] = g;
        addGlyph(g);
      }
      idx++;
      if (idx >= queue.length) finishChars();
      else step();
      return;
    }
    if (!strokes.length) {
      $('drawHint').textContent = 'Write the sentence on the pad first.';
      return;
    }
    lines[idx] = strokes;
    idx++;
    if (idx >= SPACING_PHRASES.length) finishSpacing();
    else step();
  }

  function back() {
    if (idx === 0) return;
    idx--;
    if (mode === 'chars') {
      const g = added[idx];
      step();
      if (g) {
        removeGlyph(g);
        added[idx] = null;
        pad.load(g.strokes);
      }
    } else {
      step();
    }
  }

  $('drawBtn').addEventListener('click', openChars);
  $('spacingBtn').addEventListener('click', openSpacing);
  $('drawStart').addEventListener('click', start);
  $('drawClose').addEventListener('click', () => dlg.close());
  $('drawNext').addEventListener('click', next);
  $('drawSkip').addEventListener('click', () => {
    idx++;
    if (idx >= queue.length) finishChars();
    else step();
  });
  $('drawBack').addEventListener('click', back);
  $('drawUndo').addEventListener('click', () => pad.undo());
  $('drawClear').addEventListener('click', () => pad.clear());
  dlg.addEventListener('keydown', (e) => {
    if ($('drawMain').hidden) return;
    if (e.key === 'Enter' && !['BUTTON', 'SELECT'].includes(e.target.tagName)) {
      e.preventDefault();
      next();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      pad.undo();
    }
  });
}
