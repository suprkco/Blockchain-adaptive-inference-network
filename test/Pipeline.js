import { expect } from 'chai';
import { block, fixtureInput, validate } from '../compute/model.js';
import { pipeline, runStage } from '../compute/pipeline.js';

describe('Split transformer fixture', function () {
  this.timeout(15000);
  it('matches single-process execution across separate child processes', async function () {
    const result = await pipeline(fixtureInput());
    expect(result.maxError).to.equal(0);
    expect(result.receipts[0].pid).not.to.equal(process.pid);
    expect(result.receipts[1].pid).not.to.equal(result.receipts[0].pid);
    expect(result.receipts[1].inputHash).to.equal(result.receipts[0].outputHash);
  });
  it('causal attention cannot inspect later tokens', function () {
    const x = fixtureInput();
    const y = fixtureInput();
    y[3] = y[3].map(v => v + 2);
    expect(block(block(x, 0), 1).slice(0, 3)).to.deep.equal(block(block(y, 0), 1).slice(0, 3));
  });
  it('rejects malformed and non-finite activations', function () {
    for (const x of [[], [[1]], [Array(8).fill(NaN)], [Array(8).fill(1e7)], Array(33).fill(Array(8).fill(0))]) {
      expect(() => validate(x)).to.throw();
    }
  });
  it('propagates worker errors', async function () {
    try { await runStage(fixtureInput(), 9); throw new Error('unexpected success'); }
    catch (error) { expect(error.message).to.equal('Unknown model stage'); }
  });
  it('enforces a worker deadline', async function () {
    try { await runStage(fixtureInput(), 0, 1); throw new Error('unexpected success'); }
    catch (error) { expect(error.message).to.equal('Worker timed out'); }
  });
});
