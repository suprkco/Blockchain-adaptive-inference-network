import { network } from 'hardhat';
const { ethers } = await network.create('hardhat');
const __dirname = import.meta.dirname;
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { digest, fixtureInput } from '../compute/model.js';
import { pipeline } from '../compute/pipeline.js';

async function main() {
  const [requester, worker0, worker1] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory('InferenceRegistry')).deploy();
  await registry.waitForDeployment();
  const input = fixtureInput();
  const modelHash = digest(fs.readFileSync(path.join(__dirname, '../compute/model.js'), 'utf8').replace(/\r\n/g, '\n'));
  const id = digest({ label: 'local-demo', modelHash, inputHash: digest(input) });
  const latest = await ethers.provider.getBlock('latest');
  const creation = await (await registry.create(id, modelHash, digest(input), [worker0.address, worker1.address], latest.timestamp + 3600)).wait();
  const started = performance.now();
  const result = await pipeline(input);
  const elapsedMs = performance.now() - started;
  if (result.maxError > 1e-12) throw new Error('Split/reference disagreement');
  const gas = [];
  for (const receipt of result.receipts) {
    const tx = await registry.connect([worker0, worker1][receipt.stage]).submit(id, receipt.stage, receipt.inputHash, receipt.outputHash);
    const mined = await tx.wait();
    gas.push(mined.gasUsed.toString());
  }
  const state = await registry.status(id);
  if (state.nextStage !== 2n || state.currentHash !== digest(result.output)) throw new Error('Ledger mismatch');
  const report = {
    generatedAt: new Date().toISOString(), node: process.version,
    scope: 'Two local child processes; untrained 2-block transformer; local EVM; no LLM quality or network speedup claim.',
    modelHash, inputHash: digest(input), jobId: id, requester: requester.address,
    receipts: result.receipts, maxAbsoluteError: result.maxError,
    pipelineElapsedMs: elapsedMs, createGas: creation.gasUsed.toString(), receiptGas: gas,
    completedStages: Number(state.nextStage), outputHash: state.currentHash,
  };
  fs.mkdirSync('evaluation', { recursive: true });
  fs.writeFileSync('evaluation/demo.json', JSON.stringify(report, null, 2) + '\n');
  console.log('inference / two workers / local EVM\nUNTRAINED TRANSFORMER FIXTURE; NOT A LANGUAGE MODEL DEMO\n');
  for (const r of result.receipts) console.log(`stage ${r.stage} | process ${r.pid} | receipt recorded | gas ${gas[r.stage]}`);
  console.log(`\nSplit/reference max error: ${result.maxError}\nPipeline including process startup: ${elapsedMs.toFixed(2)} ms\nLedger: 2/2 receipts. Hash continuity is not proof of correct computation.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
