// Measures this CI machine before the benchmark stack boots, so nothing else competes for the CPU.
//
//   npx tsx scripts/load/shooter-benchmark/machine-speed-ci.ts --corpus <dir> --base <bundle.js> --out <file>
//
// 1. Speed score: the pinned calibration bundle verifies fixed corpus replays; CPU time against the
//    reference machine. ci.ts uses it to tell a slow machine from a real time-limit failure.
// 2. Verifier comparison: when the PR's vendored Shooter sim differs from main's (--base), both
//    verify the same replays on this machine, interleaved. More than MAX_VERIFIER_SLOWDOWN fails.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  CALIBRATION_BUNDLE_SHA256, CALIBRATION_REPETITIONS, CALIBRATION_REPLAYS, REFERENCE_CALIBRATION_CPU_MS, SLOW_MACHINE_SCORE,
  compareVerifiers, scoreMachine, validateMachineSpeed, type MachineSpeed,
} from './machine-speed.ts';

const HEAD_BUNDLE = 'server/modules/vendor/shooter-sim.js';
const CALIBRATION_BUNDLE = `services/shooter-verifier/artifacts/${CALIBRATION_BUNDLE_SHA256}/shooter-sim.js`;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index > 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`machine_speed_missing_${name.replace(/^--/, '')}`);
  return value;
}

type Verifier = { verifyRunJSON(text: string): string };
function loadVerifier(source: string): Verifier {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const sim = (context as { SprotoShooterSim?: Verifier }).SprotoShooterSim;
  if (!sim || typeof sim.verifyRunJSON !== 'function') throw new Error('machine_speed_bundle_without_verifier');
  return sim;
}

/** CPU milliseconds for one verification, in a fresh context so no warm state carries over. */
function verifyOnce(source: string, input: string): number {
  const sim = loadVerifier(source);
  const before = process.cpuUsage();
  const receipt = JSON.parse(sim.verifyRunJSON(input)) as { ok?: unknown };
  const used = process.cpuUsage(before);
  if (receipt.ok !== true) throw new Error('machine_speed_replay_rejected');
  return (used.user + used.system) / 1000;
}

/** Sum over the replays of the fastest repetition: the least disturbed reading of each. */
function measure(sources: string[], inputs: string[]): number[] {
  const best = sources.map(() => inputs.map(() => Infinity));
  for (let repetition = 0; repetition < CALIBRATION_REPETITIONS; repetition++) {
    inputs.forEach((input, replay) => sources.forEach((source, bundle) => {
      best[bundle][replay] = Math.min(best[bundle][replay], verifyOnce(source, input));
    }));
  }
  return best.map(rows => Math.round(rows.reduce((sum, ms) => sum + ms, 0)));
}

const corpus = argument('--corpus'), basePath = argument('--base'), out = argument('--out');
const inputs = CALIBRATION_REPLAYS.map(name => {
  const fixture = JSON.parse(readFileSync(join(corpus, name), 'utf8')) as { log: unknown; issuance: unknown };
  return JSON.stringify({ log: fixture.log, ctx: { issuance: fixture.issuance } });
});
const calibration = readFileSync(CALIBRATION_BUNDLE);
if (sha256(calibration) !== CALIBRATION_BUNDLE_SHA256) throw new Error('machine_speed_calibration_bundle_changed');
const head = readFileSync(HEAD_BUNDLE), base = readFileSync(basePath);
const headSha = sha256(head), baseSha = sha256(base);

let calibrationCpuMs: number, baseCpuMs: number | null = null, headCpuMs: number | null = null;
if (headSha === baseSha) [calibrationCpuMs] = measure([calibration.toString('utf8')], inputs);
else [calibrationCpuMs, baseCpuMs, headCpuMs] = measure([calibration, base, head].map(bytes => bytes.toString('utf8')), inputs);

const { score, machineClass } = scoreMachine(calibrationCpuMs);
const speed: MachineSpeed = validateMachineSpeed({
  version: 1, cpuModel: cpus()[0]?.model.trim() || 'unknown', calibrationBundleSha256: CALIBRATION_BUNDLE_SHA256, calibrationCpuMs,
  referenceCalibrationCpuMs: REFERENCE_CALIBRATION_CPU_MS, score, slowMachineScore: SLOW_MACHINE_SCORE, machineClass,
  verifierComparison: compareVerifiers(baseSha, headSha, baseCpuMs, headCpuMs),
});
writeFileSync(out, JSON.stringify(speed) + '\n', { mode: 0o600 });

const comparison = speed.verifierComparison;
const verifierLine = comparison.state === 'same_bundle'
  ? 'Shooter verifier: same bundle as main, not compared.'
  : `Shooter verifier: ${headCpuMs} ms on this PR, ${baseCpuMs} ms on main, ratio ${comparison.ratio} (limit ${comparison.maxRatio}).`;
const lines = [
  `Machine: ${speed.cpuModel}. Speed score ${score} (reference 1.0, slow from ${SLOW_MACHINE_SCORE}): ${machineClass === 'slow' ? 'slow machine' : 'reference speed'}.`,
  verifierLine,
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Machine speed\n\n${lines.map(line => `- ${line}`).join('\n')}\n\n`);
if (comparison.slower) {
  console.error(`::error::The PR's Shooter verifier is ${comparison.ratio}x main's on the same machine (limit ${comparison.maxRatio}x).`);
  process.exitCode = 1;
}
