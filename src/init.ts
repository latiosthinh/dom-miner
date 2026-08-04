#!/usr/bin/env node
/**
 * Wire dom-miner into the current Playwright repo (CLI scripts only).
 * Cursor commands / skills stay in the consuming project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from './lib/root.js';

const NPM_SCRIPTS: Record<string, string> = {
  'dom-miner': 'dom-miner',
  'dom-miner:explore': 'dom-miner explore',
  'dom-miner:site': 'dom-miner explore site',
  'dom-miner:page': 'dom-miner explore page',
  'dom-miner:urls': 'dom-miner explore urls',
  'dom-miner:dump': 'dom-miner dump',
  'dom-miner:compact': 'dom-miner compact',
  'dom-miner:deep': 'dom-miner deep',
  'dom-miner:read': 'dom-miner read',
  'dom-miner:benchmark': 'dom-miner benchmark',
};

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function mergeGitignore(root: string): boolean {
  const gi = path.join(root, '.gitignore');
  const lines = ['data/dom-miner/', '!data/dom-miner/.gitkeep', 'test-output/dom-miner/', 'test-output/sitemap/'];
  let existing = '';
  if (fs.existsSync(gi)) existing = fs.readFileSync(gi, 'utf8');
  const add = lines.filter((l) => !existing.split(/\r?\n/).includes(l));
  if (!add.length) return false;
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(gi, `${prefix}\n# dom-miner\n${add.join('\n')}\n`);
  return true;
}

function mergePackageScripts(root: string): string[] {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error(`No package.json in ${root}`);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  pkg.scripts = pkg.scripts || {};
  const added: string[] = [];
  for (const [k, v] of Object.entries(NPM_SCRIPTS)) {
    if (!pkg.scripts[k]) {
      pkg.scripts[k] = v;
      added.push(k);
    }
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return added;
}

function main(): void {
  const root = findRepoRoot();
  console.error(`Initializing dom-miner in ${root}`);

  ensureDir(path.join(root, 'data/dom-miner'));
  const keep = path.join(root, 'data/dom-miner/.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');

  const scriptsAdded = mergePackageScripts(root);
  if (scriptsAdded.length) {
    console.error(`  ✓ package.json scripts: ${scriptsAdded.join(', ')}`);
  } else {
    console.error('  · package.json dom-miner scripts already present');
  }

  if (mergeGitignore(root)) {
    console.error('  ✓ .gitignore updated for data/dom-miner/');
  }

  console.log(`
Done. Next:

  npx playwright-core install chromium
  npx dom-miner explore site --url https://www.example.com/ --top 40

  # Other modes
  npx dom-miner explore page --url https://www.example.com/about/
  npx dom-miner explore urls --urls-file ./urls.txt --stem example

Artifacts:
  test-output/sitemap/<stem>-urls-full.json
  data/dom-miner/<stem>/

Cursor commands (/generate-application-test-plan, etc.) are owned by your
project — dom-miner does not ship them.
`);
}

main();
