// Prints the outline a judge reads of this entry, built by the kit's own outliner: the functions are lifted out of
// the kit's command line as written (nothing is re-implemented here) and run on a freshly built dossier's text.
// Run: KIT_CLI=/path/to/kit/cli/makefun.mjs node tests/outline.mjs [text budget in bytes, default 1248]
// 1248 bytes is what a 1,536-token entry has left after its three-screenshot sheet (1,120 tokens, 3 bytes a token).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.KIT_CLI;
if (!cli) throw new Error('Set KIT_CLI to the kit\'s cli/makefun.mjs');
const budget = Number(process.argv[2] ?? 1248);

const source = readFileSync(cli, 'utf8');
const from = source.indexOf('\nfunction languageOf2(');
const to = source.indexOf('\nfunction dossierJudgeView(');
if (from < 0 || to < from) throw new Error('This kit\'s command line does not hold the outliner where expected.');
const helpers = `
const DECL_MAX_BYTES = 96;
const HEAD_KEPT = /^(#{1,6}\\s|(Source files|Files|Scripts|Instances|Totals):\\s)/;
const utf8Bytes4 = s => Buffer.byteLength(s, 'utf8');
const jsonBytes = s => utf8Bytes4(JSON.stringify(s)) - 2;
const plural8 = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many);
const FENCE_OPEN2 = /^(\`{3,}|~{3,})\\s*([A-Za-z0-9_+.-]*)\\s*$/;
const JS_KEYWORDS2 = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'function', 'else', 'do', 'try', 'new', 'typeof', 'await', 'yield', 'super', 'delete', 'void', 'throw', 'in', 'of']);
const vendored = s => /(^|\\/)vendor\\//.test(s.heading.slice(4).split(' (')[0] ?? '');
const linesCost = lines => lines.reduce((n, l) => n + jsonBytes(l + '\\n'), 0);
`;
const viewText = new Function(`${helpers}${source.slice(from, to)}\nreturn viewText;`)();

const out = mkdtempSync(join(tmpdir(), 'tote-outline-'));
try {
  execFileSync(process.execPath, ['main.ts'], { cwd: repo, env: { ...process.env, MAKEFUN_OUTPUT_DIR: out }, stdio: ['ignore', 'ignore', 'inherit'] });
  const dossier = JSON.parse(readFileSync(join(out, 'dossier.json'), 'utf8'));
  const view = viewText(dossier.text, budget, dossier.images.length);
  console.log(view.text);
  console.error(`\n${view.decls} declaration lines shown, form "${view.form}", ${Buffer.byteLength(view.text)} bytes of ${budget}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
