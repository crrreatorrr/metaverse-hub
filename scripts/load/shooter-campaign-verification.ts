// Tooling only. No default endpoint and no production/remote execution.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { makePlan, type Corpus } from './shooter-benchmark/contracts.ts';

export async function main(args: string[]): Promise<void> {
  const allowed = new Set(['--corpus', '--seed', '--output', '--plan']);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`unsupported argument ${args[i]}; execution adapter is not yet integrated`);
    if (args[i] === '--plan') continue;
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('option requires value');
    options.set(args[i - 1], value);
  }
  const path = options.get('--corpus') ?? 'server/test/fixtures/shooter-integration-corpus.json';
  const bytes = await readFile(path);
  const plan = makePlan(JSON.parse(bytes.toString('utf8')) as Corpus, bytes, options.get('--seed') ?? 'shooter-pr20-v1');
  const json = `${JSON.stringify({ status: 'plan_only_no_execution', ...plan }, null, 2)}\n`;
  const output = options.get('--output');
  if (output) await writeFile(output, json, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(json);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    // Do not stringify arbitrary objects/request bodies in errors.
    console.error(error instanceof Error ? error.message : 'benchmark planning failed');
    process.exitCode = 1;
  });
}
