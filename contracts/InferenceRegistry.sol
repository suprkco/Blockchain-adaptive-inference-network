// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Ordered receipts for off-chain computation. NOT a proof of inference.
contract InferenceRegistry {
    struct Job {
        address requester;
        bytes32 modelHash;
        bytes32 currentHash;
        uint64 deadline;
        uint8 nextStage;
        bool cancelled;
        address[] workers;
    }
    mapping(bytes32 => Job) private jobs;
    event Created(bytes32 indexed id, bytes32 modelHash, bytes32 inputHash);
    event Receipt(bytes32 indexed id, uint8 stage, address indexed worker, bytes32 inputHash, bytes32 outputHash);
    event Cancelled(bytes32 indexed id);

    function create(bytes32 id, bytes32 modelHash, bytes32 inputHash, address[] calldata workers, uint64 deadline) external {
        require(id != bytes32(0) && modelHash != bytes32(0) && inputHash != bytes32(0), "empty commitment");
        require(jobs[id].requester == address(0), "job exists");
        require(workers.length > 0 && workers.length <= 8, "worker count");
        require(deadline > block.timestamp && deadline <= block.timestamp + 1 days, "deadline");
        for (uint i = 0; i < workers.length; i++) {
            require(workers[i] != address(0), "empty worker");
            for (uint j = 0; j < i; j++) require(workers[i] != workers[j], "duplicate worker");
        }
        Job storage job = jobs[id];
        job.requester = msg.sender;
        job.modelHash = modelHash;
        job.currentHash = inputHash;
        job.deadline = deadline;
        job.workers = workers;
        emit Created(id, modelHash, inputHash);
    }

    function submit(bytes32 id, uint8 stage, bytes32 inputHash, bytes32 outputHash) external {
        Job storage job = jobs[id];
        require(job.requester != address(0), "unknown job");
        require(!job.cancelled && block.timestamp <= job.deadline, "inactive job");
        require(stage == job.nextStage && stage < job.workers.length, "stage order");
        require(msg.sender == job.workers[stage], "wrong worker");
        require(inputHash == job.currentHash, "input mismatch");
        require(outputHash != bytes32(0), "empty output");
        job.currentHash = outputHash;
        job.nextStage++;
        emit Receipt(id, stage, msg.sender, inputHash, outputHash);
    }

    function cancel(bytes32 id) external {
        Job storage job = jobs[id];
        require(msg.sender == job.requester, "wrong requester");
        require(block.timestamp > job.deadline, "not expired");
        require(!job.cancelled && job.nextStage < job.workers.length, "already terminal");
        job.cancelled = true;
        emit Cancelled(id);
    }

    function status(bytes32 id) external view returns (bytes32 modelHash, bytes32 currentHash, uint8 nextStage, uint stages, bool cancelled) {
        Job storage job = jobs[id];
        require(job.requester != address(0), "unknown job");
        return (job.modelHash, job.currentHash, job.nextStage, job.workers.length, job.cancelled);
    }
}
