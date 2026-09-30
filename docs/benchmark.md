# Trained-model benchmark protocol

## Implementation and workload

The pinned all-MiniLM-L6-v2 encoder produces 384-dimensional normalized embeddings. Use `benchmark/workloads.json` for the exact public authored text and the recorded input hash. Tokenization truncates to at most 256 tokens and pads each batch. Workloads are not a held-out semantic-quality benchmark.

The reference is `AutoModel` in float32 with eager attention, followed by masked mean pooling and L2 normalization. Its standard forward also computes an unused BERT pooler output. The split path retains embeddings plus layers 0-2 in worker 0 and layers 3-5 in worker 1, followed by the same sentence pooling. That path omits the unused BERT pooler. The parent retains the full reference model. Each worker first loads the full checkpoint and then discards unassigned modules. This is not a peak-memory or GPU-memory saving experiment.

Each process uses one PyTorch thread. Workers are persistent, distinct spawned processes on the same CPU host. They do not compute sequential layers simultaneously. Activations pass through the coordinator over multiprocessing byte pipes; this is not a direct peer-to-peer connection. Payloads use a length-delimited JSON descriptor followed by contiguous numeric bytes, with bounded frame size, allowed types and shape checks; no pickle deserialization is used.

## Timing boundaries

- `local_compute_ms`: full local forward and sentence pooling on pretokenized input, including conversion to a NumPy view. Excludes JSON encoding of the control response.
- `split_wall_ms`: two sequential RPCs inside Python, including tensors, hashes, worker inference and bookkeeping. Excludes the outer Node/Python control bridge.
- `serialization_ms`: instrumented tensor frame encode/decode in parent and workers. A subset of split time, excluding some metadata framing, hashing and validation; not total IPC overhead.
- `wire_bytes`: sum of framed messages in both directions across the two parent/worker pipes. Activations are relayed and serialized again between stages. This is not a WAN bandwidth measurement.
- `ledger_ms`: the sum of three measured transaction submission/receipt waits: creation, stage 0 and stage 1. The contract runs on one in-process automining EVM, without distributed consensus.
- `split_plus_ledger_ms`: wall clock from before job creation to after the second receipt. Includes the split path, the Node/Python bridge and ledger operations. Excludes the final status read and baseline comparison.
- `startup_ms`: Python session construction, model loading and both worker initializations. Libraries imported before session creation are excluded. The committed run used an already populated checkpoint cache; this is not a first-download time.

For each workload, run three local/split warm-up pairs and one unreported ledger cycle. Then alternate baseline-before and baseline-after ordering over 20 measured repetitions. No outliers are discarded. Quantiles use nearest rank. Medians of subcomponents need not sum to the median of the end-to-end measurements.

## Tail observations

| Workload | Local p95 ms | Split p95 ms | Split + ledger p95 ms | Median framed bytes |
| --- | ---: | ---: | ---: | ---: |
| single-short | 11.18 | 13.55 | 19.70 | 52377 |
| batch-four | 22.01 | 25.79 | 33.20 | 205970 |
| batch-two-long | 70.40 | 74.42 | 80.51 | 774055 |

The artifact reports environment, revision, per-worker parameter counts, shapes, tokenization time, configuration, hashes and every measured sample. p95 from 20 samples is unstable and only descriptive. There are no independent repeat sessions, controlled CPU-frequency measurements, confidence intervals, cross-machine trials or isolated host-load controls. The results therefore describe this run and do not support a throughput or energy-efficiency claim.

## Equivalence and faults

The fixed threshold is maximum absolute error <=1e-5 on normalized embeddings. All committed observations had zero error; hardware or kernels may change that. The tests also compare an individual sentence with its padded-batch embedding. The baseline uses the original library forward; the split path calls individual encoder layers.

The recorded fault experiments use one observation each:

- crash: detected after 81.20 ms; no automatic retry.
- stall: detected after 512.38 ms; no automatic retry.
- invalid_token_id: detected after 0.63 ms; no automatic retry.

The 500 ms receive deadline is cooperative and subject to scheduling overhead. The recorded stall therefore exceeded 500 ms slightly. These checks establish bounded local failure handling, not resilience against collusion or malicious inference. There is no automatic recovery. Contract tests separately reject missing jobs, unauthorized signers, expired jobs, replay and out-of-order receipts.

## Reproduction and CI

Follow the README's pinned CPU dependency installation. Run `npm run benchmark` and `python -m benchmark.failures`; each rewrites its JSON artifact. CI runs the genuine checkpoint and a smaller three-repeat smoke benchmark; its artifact is separate from the committed 20-repeat Windows measurements. The Hugging Face checkpoint cache is keyed by the immutable model revision. CPU tensors only; safetensors weights and `trust_remote_code=False`.

## Interpretation

The split path is slower for these three CPU workloads, and the local ledger adds further latency. This falsifies an immediate latency-speedup claim for this setup. It does not falsify memory-feasibility benefits on larger models or asynchronous applications, neither of which was measured. It also does not establish that blockchain is useful: an ordinary database and independently operated remote ledger remain necessary future controls.
