const { fork } = require('node:child_process');
const path = require('node:path');
const { block, digest, validate } = require('./model');

function runStage(input, stage, timeout = 5000) {
  validate(input);
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'worker.js'), [String(stage)], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Worker timed out')), timeout);
    child.once('error', error => finish(error));
    child.once('exit', () => finish(new Error('Worker exited without a result')));
    child.once('message', result => {
      try {
        if (result.error) throw new Error(result.error);
        validate(result.output);
        if (result.stage !== stage || result.outputHash !== digest(result.output)) throw new Error('Invalid worker receipt');
        finish(null, result);
      } catch (error) { finish(error); }
    });
    child.send({ stage, input, inputHash: digest(input) });
  });
}

async function pipeline(input) {
  let activations = input;
  const receipts = [];
  for (let stage = 0; stage < 2; stage++) {
    const result = await runStage(activations, stage);
    receipts.push({ stage, pid: result.pid, inputHash: digest(activations), outputHash: result.outputHash });
    activations = result.output;
  }
  const reference = block(block(input, 0), 1);
  const maxError = Math.max(...reference.flat().map((v, i) => Math.abs(v - activations.flat()[i])));
  return { output: activations, receipts, maxError };
}
module.exports = { runStage, pipeline };
