import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve project root (folder with package.json).
 * Prefer DOM_MINER_ROOT, else walk up from cwd.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  if (process.env.DOM_MINER_ROOT) {
    return path.resolve(process.env.DOM_MINER_ROOT);
  }
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}
