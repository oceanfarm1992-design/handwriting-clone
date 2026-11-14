// Open, update or close a bot issue on GitHub (used by the scheduled workflows).
//
//   node scripts/issue.mjs open  "<title>" <body.md> [label] [extra note]
//   node scripts/issue.mjs close "<title>" [label]
//
// One open issue per title: a repeat failure adds a comment instead of a new issue, and the issue
// is closed automatically once the check passes again. Needs GH_TOKEN and the `gh` CLI.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [action, title, a3, a4, note] = process.argv.slice(2);
const label = action === 'open' ? a4 || 'bot' : a3 || null;
const run = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();

const existing = JSON.parse(gh('issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title')).find((i) => i.title === title);

if (action === 'open') {
  const report = a3 && fs.existsSync(a3) ? fs.readFileSync(a3, 'utf8') : '';
  const body = [note, report, run ? `Run with full logs: ${run}` : ''].filter(Boolean).join('\n\n');
  fs.writeFileSync('.issue-body.md', body);
  if (existing) {
    gh('issue', 'comment', String(existing.number), '--body-file', '.issue-body.md');
    console.log(`Updated issue #${existing.number}`);
  } else {
    try {
      gh('label', 'create', label, '--color', 'd93f0b', '--force');
    } catch {
      /* label already exists or no permission to create it */
    }
    console.log(gh('issue', 'create', '--title', title, '--body-file', '.issue-body.md', '--label', label));
  }
} else if (action === 'close') {
  if (existing) {
    gh('issue', 'close', String(existing.number), '--comment', `Passing again${run ? ` in ${run}` : ''}. Closing automatically.`);
    console.log(`Closed issue #${existing.number}`);
  } else console.log('Nothing to close.');
} else {
  console.error('usage: issue.mjs open|close "<title>" ...');
  process.exit(2);
}
