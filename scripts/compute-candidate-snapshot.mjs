import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: args.includes('-z') ? 'buffer' : 'utf8',
    shell: false,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`);
  }
  return result;
}

const listed = git(['ls-files', '--others', '--exclude-standard', '-z']);
const paths = listed.stdout
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .sort(); // ECMAScript default: ascending UTF-16 code unit order.

const lines = [];
let totalBytes = 0;
for (const relativePath of paths) {
  const info = await stat(relativePath);
  if (!info.isFile()) continue;
  const content = await readFile(relativePath);
  const fileHash = createHash('sha256').update(content).digest('hex');
  lines.push(`${relativePath}|${fileHash}`);
  totalBytes += content.byteLength;
}

const treeHash = createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
const branch = String(git(['symbolic-ref', '--short', 'HEAD']).stdout).trim();
const headResult = git(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
const head = headResult.status === 0 ? String(headResult.stdout).trim() : 'unborn';

console.log(
  JSON.stringify(
    {
      algorithm: 'candidate-tree-v1-node-utf16-ordinal',
      branch,
      head,
      candidateCount: paths.length,
      regularFileCount: lines.length,
      byteCount: totalBytes,
      sha256: treeHash,
    },
    null,
    2,
  ),
);
