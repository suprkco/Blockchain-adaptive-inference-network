// Small untrained causal transformer fixture. No language-quality claim.
const { createHash } = require('node:crypto');
const WIDTH = 8;
function digest(value) {
  return '0x' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function validate(x) {
  if (!Array.isArray(x) || x.length < 1 || x.length > 32 || x.some(row =>
    !Array.isArray(row) || row.length !== WIDTH || row.some(v => !Number.isFinite(v) || Math.abs(v) > 1e6))) {
    throw new Error('Expected 1..32 finite vectors of width 8, bounded by 1e6');
  }
}
function matrix(seed) {
  let state = seed;
  return Array.from({ length: WIDTH }, () => Array.from({ length: WIDTH }, () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state / 4294967296 - 0.5) * 0.4;
  }));
}
function project(row, weights) {
  return weights[0].map((_, j) => row.reduce((s, v, i) => s + v * weights[i][j], 0));
}
function norm(row) {
  const mean = row.reduce((a, b) => a + b) / WIDTH;
  const variance = row.reduce((s, v) => s + (v - mean) ** 2, 0) / WIDTH;
  return row.map(v => (v - mean) / Math.sqrt(variance + 1e-5));
}
function block(input, stage) {
  validate(input);
  if (stage !== 0 && stage !== 1) throw new Error('Unknown model stage');
  const weights = [1, 2, 3, 4, 5, 6].map(i => matrix(100 + stage * 10 + i));
  const normalized = input.map(norm);
  const q = normalized.map(x => project(x, weights[0]));
  const k = normalized.map(x => project(x, weights[1]));
  const v = normalized.map(x => project(x, weights[2]));
  const output = input.map((row, t) => {
    // A causal mask ensures token t never reads tokens after t.
    const scores = k.slice(0, t + 1).map(key => key.reduce((s, z, j) => s + z * q[t][j], 0) / Math.sqrt(WIDTH));
    const exps = scores.map(s => Math.exp(s - Math.max(...scores)));
    const sum = exps.reduce((a, b) => a + b);
    const attention = row.map((_, j) => exps.reduce((s, e, i) => s + e / sum * v[i][j], 0));
    const projected = project(attention, weights[3]);
    const residual = row.map((z, j) => z + projected[j]);
    const hidden = project(norm(residual), weights[4]).map(z => Math.max(0, z));
    const ff = project(hidden, weights[5]);
    return residual.map((z, j) => z + ff[j]);
  });
  validate(output);
  return output;
}
function fixtureInput() {
  return Array.from({ length: 4 }, (_, t) => Array.from({ length: WIDTH }, (_, j) => Math.sin((t + 1) * (j + 1))));
}
module.exports = { block, digest, validate, fixtureInput };
