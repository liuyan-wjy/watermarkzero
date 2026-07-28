import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CLEAN_PATHS = [
  'dist',
  '.artifacts',
  'src/assets/samples/fix'
];

export const OPTIONAL_CLEAN_PATHS = ['.chrome-debug'];

export function resolveCleanupTargets({ includeProfile = false } = {}) {
  return [
    ...DEFAULT_CLEAN_PATHS,
    ...(includeProfile ? OPTIONAL_CLEAN_PATHS : [])
  ];
}

export function parseCleanCliArgs(argv = []) {
  const parsed = {
    includeProfile: false,
    dryRun: false
  };

  for (const arg of argv) {
    if (arg === '--include-profile') {
      parsed.includeProfile = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern) {
  return new RegExp(`^${escapeRegex(pattern).replace(/\*/g, '.*')}$`);
}

export async function expandCleanupTarget(target) {
  if (!target.includes('*')) {
    return [path.resolve(target)];
  }

  const baseDir = path.resolve(path.dirname(target));
  const namePattern = path.basename(target);
  const matcher = globToRegex(namePattern);

  if (!existsSync(baseDir)) {
    return [];
  }

  const entries = await readdir(baseDir, { withFileTypes: true });
  return entries
    .filter((entry) => matcher.test(entry.name))
    .map((entry) => path.join(baseDir, entry.name));
}

export async function runCleanup(options = {}) {
  const { includeProfile = false, dryRun = false } = options;
  const targets = resolveCleanupTargets({ includeProfile });
  const removed = [];

  for (const target of targets) {
    const paths = await expandCleanupTarget(target);
    for (const absolutePath of paths) {
      if (!existsSync(absolutePath)) {
        continue;
      }
      removed.push(absolutePath);
      if (!dryRun) {
        await rm(absolutePath, { recursive: true, force: true });
      }
    }
  }

  return {
    targets,
    removed,
    dryRun
  };
}

async function runCli() {
  const options = parseCleanCliArgs(process.argv.slice(2));
  const result = await runCleanup(options);

  if (result.removed.length === 0) {
    console.log('没有需要清理的内容。');
    return;
  }

  console.log(options.dryRun ? '将会清理以下路径：' : '已清理以下路径：');
  for (const removedPath of result.removed) {
    console.log(path.relative(process.cwd(), removedPath) || removedPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
