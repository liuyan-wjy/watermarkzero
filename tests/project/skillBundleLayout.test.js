import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { readdir, mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const skillRoot = new URL('../../skills/gemini-watermark-remover/', import.meta.url);
const repoRoot = new URL('../../', import.meta.url);

function sortedNames(entries) {
  return entries.map((entry) => entry.name).sort();
}

function extractMarkdownHeadingLines(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{2,6}\s+\S/.test(line));
}

function headingOrderIndex(headings, exactHeadingLine) {
  return headings.indexOf(exactHeadingLine);
}

test('skill bundle should include required files', async () => {
  for (const relativePath of [
    'SKILL.md',
    'agents/openai.yaml',
    'references/usage.md',
    'references/inputs-and-outputs.md',
    'references/limitations.md',
    'scripts/run.mjs'
  ]) {
    await access(new URL(relativePath, skillRoot));
  }
});

test('skill bundle should match the allowed directory layout only', async () => {
  const topLevelEntries = await readdir(skillRoot, { withFileTypes: true });
  assert.deepEqual(
    sortedNames(topLevelEntries),
    ['SKILL.md', 'agents', 'references', 'scripts']
  );

  const topLevelMap = new Map(topLevelEntries.map((entry) => [entry.name, entry]));
  assert.ok(topLevelMap.get('SKILL.md')?.isFile(), 'SKILL.md must be a file');
  assert.ok(topLevelMap.get('agents')?.isDirectory(), 'agents must be a directory');
  assert.ok(topLevelMap.get('references')?.isDirectory(), 'references must be a directory');
  assert.ok(topLevelMap.get('scripts')?.isDirectory(), 'scripts must be a directory');

  const agentEntries = await readdir(new URL('agents/', skillRoot), { withFileTypes: true });
  assert.deepEqual(sortedNames(agentEntries), ['openai.yaml']);
  assert.ok(agentEntries[0]?.isFile(), 'agents/openai.yaml must be a file');

  const referenceEntries = await readdir(new URL('references/', skillRoot), { withFileTypes: true });
  assert.deepEqual(
    sortedNames(referenceEntries),
    ['inputs-and-outputs.md', 'limitations.md', 'usage.md']
  );
  for (const entry of referenceEntries) {
    assert.ok(entry.isFile(), `references/${entry.name} must be a file`);
  }

  const scriptEntries = await readdir(new URL('scripts/', skillRoot), { withFileTypes: true });
  assert.deepEqual(sortedNames(scriptEntries), ['run.mjs']);
  assert.ok(scriptEntries[0]?.isFile(), 'scripts/run.mjs must be a file');
});

test('skill runtime script should not import repository source directories directly', async () => {
  const source = await readFile(new URL('scripts/run.mjs', skillRoot), 'utf8');
  for (const forbiddenPattern of [
    /from\s+['"`][^'"`\r\n]*src(?:\/|\\)[^'"`\r\n]*['"`]/i,
    /import\s*\(\s*['"`][^'"`\r\n]*src(?:\/|\\)[^'"`\r\n]*['"`]\s*\)/i,
    /require\s*\(\s*['"`][^'"`\r\n]*src(?:\/|\\)[^'"`\r\n]*['"`]\s*\)/i,
    /['"`](?:[^'"`\r\n]*\.\.[\\/])+src(?:[\\/][^'"`\r\n]*)?['"`]/i,
    /['"`][^'"`\r\n]*[\\/]+src(?:[\\/][^'"`\r\n]*)?['"`]/i
  ]) {
    assert.doesNotMatch(source, forbiddenPattern);
  }
});

test('skill runtime script should provide a direct executable entrypoint', async () => {
  const source = await readFile(new URL('scripts/run.mjs', skillRoot), 'utf8');
  assert.match(source, /export\s+async\s+function\s+main\s*\(/);
  assert.match(source, /process\.argv\.slice\(2\)/);
  assert.match(source, /if\s*\(\s*isDirectRun\(\)\s*\)/);
});

test('skill runtime script should include Windows PATH fallback shim behavior', async () => {
  const source = await readFile(new URL('scripts/run.mjs', skillRoot), 'utf8');
  assert.match(source, /process\.platform\s*===\s*['"]win32['"]/);
  assert.match(source, /ComSpec|cmd\.exe/);
  assert.match(source, /['"]gwr['"]/);
  assert.match(source, /['"]pnpm['"]/);
  assert.match(source, /['"]dlx['"]/);
  assert.match(source, /['"]@pilio\/gemini-watermark-remover['"]/);
});

test('skill docs should explicitly include the remove subcommand shape', async () => {
  const skillDoc = await readFile(new URL('SKILL.md', skillRoot), 'utf8');
  const usageDoc = await readFile(new URL('references/usage.md', skillRoot), 'utf8');
  const ioDoc = await readFile(new URL('references/inputs-and-outputs.md', skillRoot), 'utf8');
  const agentSpec = await readFile(new URL('agents/openai.yaml', skillRoot), 'utf8');

  assert.match(skillDoc, /node\s+scripts\/run\.mjs\s+remove\s+/i);
  assert.match(usageDoc, /node\s+scripts\/run\.mjs\s+remove\s+/i);
  assert.match(ioDoc, /remove/i);
  assert.match(agentSpec, /remove/i);
});

test('skill runtime script should run with --help in repository workspace', async () => {
  const scriptPath = fileURLToPath(new URL('scripts/run.mjs', skillRoot));

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, '--help'], {
      cwd: fileURLToPath(repoRoot),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(
    result.code,
    0,
    `expected run.mjs --help to exit 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Usage:\s*gwr\s+remove/i,
    'expected help output to include "Usage: gwr remove"'
  );
});

test('installed skill runtime should fall back to pnpm dlx when repo-local bin is unavailable', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gwr-skill-install-'));
  const installRoot = path.join(tempDir, '.agents', 'skills', 'gemini-watermark-remover');
  await mkdir(path.join(tempDir, 'bin'), { recursive: true });
  await cp(fileURLToPath(skillRoot), installRoot, { recursive: true });
  const packageSpec = '@pilio/gemini-watermark-remover';

  if (process.platform === 'win32') {
    const fakePnpmPath = path.join(tempDir, 'bin', 'pnpm.cmd');
    const fakePnpmScriptPath = path.join(tempDir, 'bin', 'fake-pnpm.cjs');
    const repoCliPath = fileURLToPath(new URL('../../bin/gwr.mjs', import.meta.url));
    await writeFile(
      fakePnpmScriptPath,
      `const { spawnSync } = require('node:child_process');\nconst args = process.argv.slice(2);\nif (args[0] === 'dlx') args.shift();\nif (args[0] === '${packageSpec}') args.shift();\nconst result = spawnSync(process.execPath, ['${repoCliPath.replace(/\\/g, '\\\\')}', ...args], { stdio: 'inherit' });\nprocess.exit(result.status ?? 1);\n`,
      'utf8'
    );
    await writeFile(
      fakePnpmPath,
      `@echo off\r\nnode "%~dp0fake-pnpm.cjs" %*\r\n`,
      'utf8'
    );
  } else {
    const fakePnpmPath = path.join(tempDir, 'bin', 'pnpm');
    const repoCliPath = fileURLToPath(new URL('../../bin/gwr.mjs', import.meta.url));
    await writeFile(
      fakePnpmPath,
      `#!/usr/bin/env sh\nif [ "$1" = "dlx" ]; then shift; fi\nif [ "$1" = "@pilio/gemini-watermark-remover" ]; then shift; fi\nnode "${repoCliPath}" "$@"\n`,
      'utf8'
    );
  }

  const scriptPath = path.join(installRoot, 'scripts', 'run.mjs');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, '--help'], {
      cwd: tempDir,
      env: {
        ...process.env,
        GWR_SKILL_CLI_SPEC: packageSpec,
        PATH: `${path.join(tempDir, 'bin')}${path.delimiter}${process.env.PATH || ''}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, `expected installed skill fallback to exit 0\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /Usage:\s*gwr\s+remove/i);
});

test('README (zh) should prioritize section headings for online tool, userscript, Skill, and CLI before SDK', async () => {
  const readme = await readFile(new URL('../../README_zh.md', import.meta.url), 'utf8');
  const headings = extractMarkdownHeadingLines(readme);
  const onlineIndex = headingOrderIndex(headings, '### 在线 Gemini 去水印工具（推荐）');
  const userscriptIndex = headingOrderIndex(headings, '### 油猴脚本');
  const skillIndex = headingOrderIndex(headings, '### Skill');
  const cliIndex = headingOrderIndex(headings, '### CLI');
  const developerPreviewIndex = headingOrderIndex(headings, '### 开发者预览');
  const developmentIndex = headingOrderIndex(headings, '## 开发');
  const sdkIndex = headingOrderIndex(headings, '## SDK 用法（高级 / 内部）');

  assert.ok(onlineIndex >= 0);
  assert.ok(userscriptIndex > onlineIndex);
  assert.ok(skillIndex > userscriptIndex);
  assert.ok(cliIndex > skillIndex);
  assert.ok(developerPreviewIndex > cliIndex);
  assert.ok(developmentIndex > developerPreviewIndex);
  assert.ok(sdkIndex > cliIndex);
});

test('README (English) should prioritize online tool, userscript, Skill, and CLI before SDK', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const headings = extractMarkdownHeadingLines(readme);
  const onlineIndex = headingOrderIndex(headings, '### Online Gemini Watermark Remover (Recommended)');
  const userscriptIndex = headingOrderIndex(headings, '### Userscript');
  const skillIndex = headingOrderIndex(headings, '### Skill');
  const cliIndex = headingOrderIndex(headings, '### CLI');
  const developerPreviewIndex = headingOrderIndex(headings, '### Developer Preview');
  const developmentIndex = headingOrderIndex(headings, '## Development');
  const sdkIndex = headingOrderIndex(headings, '## SDK Usage (Advanced / Internal)');

  assert.ok(onlineIndex >= 0);
  assert.ok(userscriptIndex > onlineIndex);
  assert.ok(skillIndex > userscriptIndex);
  assert.ok(cliIndex > skillIndex);
  assert.ok(developerPreviewIndex > cliIndex);
  assert.ok(developmentIndex > developerPreviewIndex);
  assert.ok(sdkIndex > cliIndex);
});
