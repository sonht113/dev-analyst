#!/usr/bin/env node
import process from 'node:process';
import { runCli } from './index.js';

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
});
