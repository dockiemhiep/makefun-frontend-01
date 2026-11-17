// Hands the entry in: copies app/ and screenshots/ beside a freshly built dossier.json.
// Node 22, standard library only, no network; two runs write the same bytes.
import { chmodSync, cpSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const HANDED_IN = ['app', 'screenshots'];
const CAPS = {
  text_max_bytes: 160 * 1024,
  screenshots: { max: 3, max_bytes: 256 * 1024 },
  app_max_files: 993,
  app_max_bytes: 16 * 1024 * 1024,
};

const here = fileURLToPath(new URL('.', import.meta.url));
const target = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const fromRepo = relative(here, target);
const outside = fromRepo === '..' || fromRepo.startsWith('..' + sep) || isAbsolute(fromRepo);
if (!outside) {
  throw new Error(`Refusing to hand in to ${target}: it is inside the repository.`);
}

const hidden = (path: string): boolean => basename(path).startsWith('.');

// Only plain files and directories are handed in; a link or device would fail the gate's app_files row.
function assertPlain(directory: string): void {
  for (const name of readdirSync(directory)) {
    if (hidden(name)) continue;
    const path = join(directory, name);
    const kind = lstatSync(path);
    if (kind.isDirectory()) assertPlain(path);
    else if (!kind.isFile()) throw new Error(`Not a plain file: ${relative(here, path)}`);
  }
}

// A copy keeps its source's mode; from a read-only checkout that would leave copies a later run cannot replace.
function makeWritable(path: string): void {
  const directory = lstatSync(path).isDirectory();
  chmodSync(path, directory ? 0o755 : 0o644);
  if (directory) for (const name of readdirSync(path)) makeWritable(join(path, name));
}

mkdirSync(target, { recursive: true });
for (const directory of HANDED_IN) {
  const from = join(here, directory);
  const to = join(target, directory);
  assertPlain(from);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: path => path === from || !hidden(path) });
  makeWritable(to);
}

const dossier = buildDossier(target, CAPS);
writeFileSync(join(target, 'dossier.json'), dossier);
console.log(`Handed in ${HANDED_IN.join(' + ')} and a ${Buffer.byteLength(dossier)}-byte dossier to ${target}`);
