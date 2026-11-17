import { cpSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const repository = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
if (output === resolve(repository) || output.startsWith(resolve(repository) + sep)) {
  throw new Error('The output directory must be outside the source repository.');
}
mkdirSync(output, { recursive: true });
for (const directory of ['app', 'screenshots']) {
  const source = join(repository, directory);
  for (const entry of readdirSync(source)) {
    if (!lstatSync(join(source, entry)).isFile() && !lstatSync(join(source, entry)).isDirectory()) {
      throw new Error(`Only regular files and directories may be packaged: ${directory}/${entry}`);
    }
  }
  const target = join(output, directory);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true, filter: name => !basename(name).startsWith('.') });
}
const dossier = buildDossier(output, {
  text_max_bytes: 163840,
  screenshots: { max: 3, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
});
writeFileSync(join(output, 'dossier.json'), dossier);
console.log(`Packaged app, three screenshots, and ${Buffer.byteLength(dossier)} dossier bytes.`);
