# Decision: measurement before economic or cryptographic claims

Status: accepted for the current research prototype, 30 September 2026.

The supported deliverable is a trained-model benchmark for split inference and ledger overhead. It is not a deployable DePIN marketplace. The white paper preserves a longer-term research direction, with implemented and proposed features separated.

## Why mismatched hashes must not trigger slashing

Two different hashes establish disagreement, not which participant is correct. A dishonest challenger could submit any alternative hash, while honest hardware can produce slightly different floating-point results. Staking adds an incentive but does not supply the missing adjudicator. A useful optimistic protocol needs a specified validity rule, available committed execution evidence, a bounded challenge window, and an independent way to resolve a dispute. False challenges, withheld data, numerical disagreement and collusion must be addressed before a penalty can be justified.

The local contract deliberately remains a receipt registry. Its negative-security test documents this boundary; do not interpret it as a verifier or add a claim that a stake makes its statements correct.

## Why simulated attestations are not TEE verification

A locally generated signature or a mocked enclave flag would test an interface, not attestation. A real implementation would need an attestation chain, measured code/model identity, freshness, an explicit hardware trust base and a policy for compromised or revoked identities. Similarly, a ZK integration must verify a proof bound to the exact model, inputs and computation, without silently running in a framework's development/mock mode. Proof cost and numerical representation must be measured.

## Selected scope

Use the licensed, revision-pinned all-MiniLM-L6-v2 encoder, split its six layers across two persistent processes, and compare its normalized embeddings with the unmodified local reference. Measure computation, tensor codec, IPC and local ledger calls separately. Publish failures and raw samples. Do not call local automining distributed consensus, or use process-level equivalence as a cryptographic proof.

The next evidence-driven extensions are remote transport on two physical machines and controlled verification experiments. A live token, slashing contract, ZK verifier or TEE integration requires a separate implementation and validation effort.
