import { network } from 'hardhat';
const { ethers, networkHelpers } = await network.create('hardhat');
const { time } = networkHelpers;
import { expect } from 'chai';



describe('InferenceRegistry: ordered receipts, not verified inference', function () {
  let registry, owner, first, second, stranger, deadline;
  const id = ethers.id('job');
  const model = ethers.id('model');
  const input = ethers.id('input');
  const middle = ethers.id('middle');
  const output = ethers.id('output');
  beforeEach(async function () {
    [owner, first, second, stranger] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory('InferenceRegistry')).deploy();
    deadline = await time.latest() + 1000;
    await registry.create(id, model, input, [first.address, second.address], deadline);
  });
  it('records a complete linked pipeline', async function () {
    await expect(registry.connect(first).submit(id, 0, input, middle)).to.emit(registry, 'Receipt').withArgs(id, 0, first.address, input, middle);
    await registry.connect(second).submit(id, 1, middle, output);
    const state = await registry.status(id);
    expect(state.nextStage).to.equal(2);
    expect(state.currentHash).to.equal(output);
    expect(state.modelHash).to.equal(model);
  });
  it('rejects an unauthorized signer', async function () {
    await expect(registry.connect(stranger).submit(id, 0, input, middle)).to.be.revertedWith('wrong worker');
  });
  it('rejects out-of-order, mismatched and repeated receipts', async function () {
    await expect(registry.connect(second).submit(id, 1, input, output)).to.be.revertedWith('stage order');
    await expect(registry.connect(first).submit(id, 0, middle, output)).to.be.revertedWith('input mismatch');
    await registry.connect(first).submit(id, 0, input, middle);
    await expect(registry.connect(first).submit(id, 0, input, middle)).to.be.revertedWith('stage order');
  });
  it('rejects zero output and unknown jobs', async function () {
    await expect(registry.connect(first).submit(id, 0, input, ethers.ZeroHash)).to.be.revertedWith('empty output');
    await expect(registry.connect(first).submit(ethers.id('missing'), 0, input, output)).to.be.revertedWith('unknown job');
  });
  it('prevents duplicate jobs and invalid worker allocations', async function () {
    await expect(registry.create(id, model, input, [first.address], deadline)).to.be.revertedWith('job exists');
    const next = ethers.id('next');
    await expect(registry.create(next, model, input, [], deadline)).to.be.revertedWith('worker count');
    await expect(registry.create(next, model, input, [ethers.ZeroAddress], deadline)).to.be.revertedWith('empty worker');
    await expect(registry.create(next, model, input, [first.address, first.address], deadline)).to.be.revertedWith('duplicate worker');
    await expect(registry.create(next, ethers.ZeroHash, input, [first.address], deadline)).to.be.revertedWith('empty commitment');
  });
  it('rejects invalid deadlines', async function () {
    for (const d of [await time.latest() - 1, await time.latest() + 90000]) {
      await expect(registry.create(ethers.id('next'), model, input, [first.address], d)).to.be.revertedWith('deadline');
    }
  });
  it('expires without silently accepting or retrying computation', async function () {
    await expect(registry.cancel(id)).to.be.revertedWith('not expired');
    await time.increaseTo(deadline + 1);
    await expect(registry.connect(first).submit(id, 0, input, middle)).to.be.revertedWith('inactive job');
    await expect(registry.connect(stranger).cancel(id)).to.be.revertedWith('wrong requester');
    await registry.connect(owner).cancel(id);
    expect((await registry.status(id)).cancelled).to.equal(true);
    await expect(registry.cancel(id)).to.be.revertedWith('already terminal');
  });
  it('does not cancel or overwrite a completed job', async function () {
    await registry.connect(first).submit(id, 0, input, middle);
    await registry.connect(second).submit(id, 1, middle, output);
    await expect(registry.connect(second).submit(id, 1, middle, output)).to.be.revertedWith('stage order');
    await time.increaseTo(deadline + 1);
    await expect(registry.cancel(id)).to.be.revertedWith('already terminal');
  });
  it('explicitly demonstrates that an authorized false output hash is accepted', async function () {
    const invented = ethers.id('not a computed activation');
    await registry.connect(first).submit(id, 0, input, invented);
    expect((await registry.status(id)).currentHash).to.equal(invented);
  });
});
