import { network } from 'hardhat';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import { performance } from 'node:perf_hooks';

const count = Number(process.env.BENCH_REPEATS || 20);
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('BENCH_REPEATS must be 1..100');

function summary(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return { n: values.length, p50: ordered[Math.ceil(ordered.length * 0.5) - 1],
    p95: ordered[Math.ceil(ordered.length * 0.95) - 1],
    min: ordered[0], max: ordered.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length };
}

async function main() {
  const child = spawn(process.env.BENCH_PYTHON || 'python', ['-m', 'benchmark.server'], {
    stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TOKENIZERS_PARALLELISM: 'false', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1' },
  });
  const reader = readline.createInterface({ input: child.stdout });
  const iterator = reader[Symbol.asyncIterator]();
  let childError;
  child.on('error', error => { childError = error; });
  async function receive() {
    let timer;
    try {
      const next = await Promise.race([iterator.next(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Benchmark controller timed out')), 300000);
      })]);
      if (next.done) throw childError || new Error('Python controller exited before returning a result');
      return JSON.parse(next.value);
    } finally { clearTimeout(timer); }
  }
  async function rpc(command) {
    const start = performance.now();
    child.stdin.write(JSON.stringify(command) + '\n');
    return { ...await receive(), rpc_wall_ms: performance.now() - start };
  }
  try {
    console.log('Loading the pinned MiniLM checkpoint and two persistent CPU workers...');
    const environment = await receive();
    if (!environment.ready) throw new Error('Workers did not initialize');
    const { ethers } = await network.create('hardhat');
    const signers = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory('InferenceRegistry')).deploy();
    await registry.waitForDeployment();
    const modelHash = ethers.id(JSON.stringify({ model: environment.model, revision: environment.revision,
      partition: [3, 3], precision: 'float32', attention: 'eager', pooling: 'masked-mean-l2', torch: environment.torch }));
    const workloadText = fs.readFileSync('benchmark/workloads.json', 'utf8');
    const cases = JSON.parse(workloadText).cases;
    const observations = [];
    const preparations = [];
    for (const workload of cases) {
      const key = workload.name;
      const prepared = await rpc({ action: 'prepare', case: key, texts: workload.texts });
      preparations.push({ case: key, ...prepared });
      for (let warm = 0; warm < 3; warm++) {
        await rpc({ action: 'local', case: key });
        await rpc({ action: 'split', case: key, request_id: `warm-${key}-${warm}` });
      }
      // Warm the same ledger operations once per case; exclude from reported samples.
      for (let sample = -1; sample < count; sample++) {
        let local;
        if (sample % 2 === 0) local = await rpc({ action: 'local', case: key });
        const id = ethers.id(`${key}:${sample}`);
        const latest = await ethers.provider.getBlock('latest');
        const started = performance.now();
        const createStart = performance.now();
        const created = await (await registry.create(id, modelHash, prepared.input_hash,
          [signers[1].address, signers[2].address], latest.timestamp + 3600)).wait();
        const createMs = performance.now() - createStart;
        const split = await rpc({ action: 'split', case: key, request_id: `${key}-${sample}` });
        const receipts = [];
        for (let stage = 0; stage < 2; stage++) {
          const metrics = split.stages[stage];
          const txStart = performance.now();
          const mined = await (await registry.connect(signers[stage + 1]).submit(id, stage, metrics.input_hash, metrics.output_hash)).wait();
          receipts.push({ wall_ms: performance.now() - txStart, gas: mined.gasUsed.toString() });
        }
        const e2eMs = performance.now() - started;
        const state = await registry.status(id);
        if (state.nextStage !== 2n || state.currentHash !== split.stages[1].output_hash) throw new Error('Final ledger mismatch');
        if (sample % 2 !== 0) local = await rpc({ action: 'local', case: key });
        const maxError = Math.max(...local.embedding.flat().map((v, i) => Math.abs(v - split.embedding.flat()[i])));
        if (maxError > 1e-5) throw new Error(`Numerical non-equivalence: ${maxError}`);
        if (sample >= 0) {
          observations.push({ case: key, sample, local_first: sample % 2 === 0,
            local_compute_ms: local.local_compute_ms, local_rpc_ms: local.rpc_wall_ms,
            split_wall_ms: split.split_wall_ms, split_rpc_ms: split.rpc_wall_ms,
            serialization_ms: split.serialization_ms, wire_bytes: split.wire_bytes,
            stage_compute_ms: split.stages.map(s => s.compute_ms), stages: split.stages,
            ledger_ms: createMs + receipts.reduce((total, receipt) => total + receipt.wall_ms, 0),
            create_ms: createMs, create_gas: created.gasUsed.toString(), receipt_metrics: receipts,
            split_plus_ledger_ms: e2eMs, max_absolute_error: maxError,
            completed_stages: Number(state.nextStage), output_hash: state.currentHash });
        }
      }
    }
    const metrics = ['local_compute_ms', 'split_wall_ms', 'serialization_ms', 'ledger_ms', 'split_plus_ledger_ms', 'wire_bytes', 'max_absolute_error'];
    const summaries = cases.map(c => ({ case: c.name, ...Object.fromEntries(metrics.map(metric =>
      [metric, summary(observations.filter(row => row.case === c.name).map(row => row[metric]))])) }));
    const report = { generated_at: new Date().toISOString(), environment, node: process.version,
      scope: 'CPU, one host, two spawned processes, local binary IPC, in-process automining EVM; no distributed consensus or WAN benchmark.',
      protocol: { repeats: count, warmup_each: 3, ledger_warmup_each: 1, alternate_local_split_order: true,
        timing: 'Tokenization/model initialization/deployment excluded. Ledger creation and two receipts are serialized around the split run. Status checks and the reference are outside e2e timing.',
        quantiles: 'nearest rank; descriptive samples from one process session, not independent trials',
        equivalence_atol: 1e-5, adaptive_scheduling: false },
      workload_sha256: ethers.sha256(ethers.toUtf8Bytes(workloadText)), model_manifest_hash: modelHash,
      preparations, summaries, observations };
    fs.mkdirSync('evaluation', { recursive: true });
    fs.writeFileSync('evaluation/embedding-benchmark.json', JSON.stringify(report, null, 2) + '\n');
    console.log('\nMiniLM / trained embeddings / CPU / milliseconds (p50)');
    console.log('CASE                 LOCAL    SPLIT    CODEC    LEDGER   END-TO-END');
    for (const row of summaries) console.log(`${row.case.padEnd(20)} ${metrics.slice(0, 5).map(m => row[m].p50.toFixed(2).padStart(8)).join(' ')}`);
    console.log('\nLocal EVM timings are not public-chain consensus latency. Full samples: evaluation/embedding-benchmark.json');
  } finally {
    child.stdin.end(JSON.stringify({ action: 'stop' }) + '\n');
    reader.close();
    const timer = setTimeout(() => child.kill(), 5000);
    child.once('exit', () => clearTimeout(timer));
    timer.unref();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
