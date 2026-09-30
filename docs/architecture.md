# Architecture and trust boundaries

## What is shared

A transformer has sequential computation blocks. In this prototype, two separate Node.js child processes each execute one block of a fixed, tiny untrained transformer. Activations pass over local IPC. A single coordinator owns process scheduling and all local test signers. This is an actual split forward pass, not distributed training, a peer-to-peer network or a production LLM.

The fixture has width 8, four input vectors and two blocks. Each block implements pre-normalization, single-head causal attention, residual addition and a ReLU feed-forward projection. Fixed seeded weights are generated only for the requested block. There is no tokenizer, vocabulary head, KV cache, trained checkpoint or text generation. `modelHash` fingerprints the normalized source defining weights and execution; it is not a portable model serialization format.

## What the chain does

The requester commits a job ID, model hash, initial activation hash, ordered worker addresses and a deadline. Only the assigned signer can submit the next receipt. Each input hash must match the previous output hash. Replays, missing jobs, out-of-order stages and late submissions revert. Expired unfinished jobs can be cancelled by their requester. No funds, tokens, incentives or external chain are involved.

Receipts are submitted after off-chain execution; the demo does not require mining between transformer layers. Recording every layer of every generated token would be expensive and slow. A production design would need coarser receipts or batching, alongside an explicit dispute/verification model.

## What the chain cannot prove

Any authorized worker can submit an invented nonzero output hash. A dedicated test demonstrates this. Hash continuity authenticates a sequence of statements, not the truth of the computation or output availability. The coordinator recomputes the entire tiny model to check equivalence in the demo; this removes any compute-saving advantage and is not trustless verification.

No authenticated remote transport, peer discovery, anti-Sybil mechanism, Byzantine fault tolerance, secure enclave, zero-knowledge proof, replicated consensus on inference, payment or slashing is implemented. Local workers are trusted processes. Numeric validation and timeouts bound the demo's input and waiting behavior; they do not sandbox hostile workers.

## Privacy

Raw input vectors and activations remain outside the chain but are visible to the coordinator and workers. Plain hashes are not encryption or a privacy guarantee: predictable inputs can be guessed, and activations may leak information. Use public/synthetic inputs only. No private data has been used in the demo.

## Next milestone: a trained language model across machines

1. Choose a licensed trained checkpoint, pin its revision, define exact tensor serialization and partition boundaries.
2. Run a private network with real remote workers, authenticated transport, activation limits, timeouts and model-version negotiation.
3. Compare split and single-host outputs at stated numerical tolerances. Measure network bytes, memory per worker, token latency, throughput and failure recovery.
4. Decide whether independent participants truly need a shared ledger. A trusted cluster usually needs only an ordinary scheduler and database.
5. Design correctness verification and availability before considering payment. Do not equate signed receipts with proof of work.

Related primary sources: [Petals](https://github.com/bigscience-workshop/petals) implements distributed execution of trained model blocks; [the Petals research paper](https://arxiv.org/abs/2312.08361) studies the network setting. This repository neither integrates Petals nor claims its results. [Ethereum's oracle documentation](https://ethereum.org/developers/docs/oracles/) explains the boundary between off-chain computation and on-chain statements.
