#!/usr/bin/env node
import { loadContent } from './content.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const positional = args.filter(arg => arg !== '--json');
if (positional.length !== 1 || positional.some(arg => arg.startsWith('-'))) {
  process.stderr.write('Usage: node validate-content.mjs <content-directory> [--json]\n');
  process.exitCode = 2;
} else {
  const result = await loadContent(positional[0]);
  if (json) process.stdout.write(`${JSON.stringify({ valid: result.valid, counts: result.counts, metrics: result.metrics, errors: result.errors }, null, 2)}\n`);
  else {
    for (const error of result.errors) process.stderr.write(`${error.filename}:${error.path} [${error.code}] ${error.message}\n`);
    const { total, published, draft, invalid } = result.counts;
    process.stdout.write(`${result.valid ? 'PASS' : 'FAIL'}: ${total} articles, ${published} published, ${draft} drafts, ${invalid} invalid.\n`);
    process.stdout.write(`Published metrics: ${result.metrics.repositories} repositories, ${result.metrics.categories} categories, ${result.metrics.tags} tags.\n`);
  }
  process.exitCode = result.valid ? 0 : 1;
}
