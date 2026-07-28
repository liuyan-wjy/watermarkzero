#!/usr/bin/env node
import { main } from '../src/cli/gwrCli.js';

const exitCode = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd()
});

if (typeof exitCode === 'number' && exitCode !== 0) {
  process.exitCode = exitCode;
}
