import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier, type DossierCaps } from './vendor/makefun-frontend.ts';

const DOSSIER_CAPS: DossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 3, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 16777216,
};

function shouldCopyEntry(sourcePath: string, rootPath: string): boolean {
  if (sourcePath === rootPath) return true;
  const name = basename(sourcePath);
  return !name.startsWith('.');
}

function stageSubmission(repoRoot: string, outputDir: string): void {
  const appSource = join(repoRoot, 'app');
  const shotsSource = join(repoRoot, 'screenshots');
  const appTarget = join(outputDir, 'app');
  const shotsTarget = join(outputDir, 'screenshots');

  mkdirSync(outputDir, { recursive: true });
  rmSync(appTarget, { recursive: true, force: true });
  rmSync(shotsTarget, { recursive: true, force: true });

  cpSync(appSource, appTarget, {
    recursive: true,
    filter: (src) => shouldCopyEntry(src, appSource),
  });

  mkdirSync(shotsTarget, { recursive: true });
  if (existsSync(shotsSource)) {
    cpSync(shotsSource, shotsTarget, {
      recursive: true,
      filter: (src) => shouldCopyEntry(src, shotsSource),
    });
  }

  const dossierBytes = buildDossier(outputDir, DOSSIER_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);
}

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const targetOutputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
stageSubmission(repoRoot, targetOutputDir);
