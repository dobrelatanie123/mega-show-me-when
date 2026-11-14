// R6: copy app/ to dist/ and stamp the build's git sha into the page (meta + footer).
// On Vercel the sha comes from VERCEL_GIT_COMMIT_SHA; locally from git.
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sha =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  execSync('git rev-parse HEAD').toString().trim();
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a git sha: ${sha}`);

rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
const html = readFileSync('dist/index.html', 'utf8').replaceAll('__BUILD_SHA__', sha);
writeFileSync('dist/index.html', html);
console.log(`stamped build ${sha}`);
