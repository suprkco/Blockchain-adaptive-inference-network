const { block, digest } = require('./model');
const stage = Number(process.argv[2]);
process.once('message', request => {
  try {
    if (!request || request.stage !== stage) throw new Error('Assigned stage mismatch');
    if (digest(request.input) !== request.inputHash) throw new Error('Input digest mismatch');
    const output = block(request.input, stage);
    process.send({ stage, pid: process.pid, output, outputHash: digest(output) });
  } catch (error) {
    process.send({ error: error.message });
  } finally {
    process.disconnect();
  }
});
