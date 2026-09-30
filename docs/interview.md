# Five-minute interview walkthrough

1. Open evaluation/embedding-benchmark.json and the README table. Explain why the measured split path is slower than the local model on this host.
2. Run npm run benchmark using the documented Python environment. Trace encoder layers 0-2, binary activations, layers 3-5, masked pooling and normalized embeddings.
3. Distinguish local forward time, split time, tensor codec subset, local ledger time and measured end-to-end time. Local automining is not distributed consensus.
4. Show padding invariance and the crash/stall tests. The report contains observations, not claims of automatic recovery or adversarial correctness.
5. Show the contract accepting a fabricated hash from an authorized worker. Explain why a second conflicting hash cannot determine who should be slashed.

This is a trained-model benchmarking project with a research proposal for adaptive networks. It is not a production DePIN service, proof-of-inference protocol or generative LLM. The next experiment should use two physical machines and controlled links, with an ordinary database as a comparison.
