import { network } from 'hardhat';
const { ethers, networkHelpers } = await network.create('hardhat');
const { time, loadFixture } = networkHelpers;
import { expect } from 'chai';

describe("NumberStorage contract", function () {
  let NumberStorage;
  let numberStorage;
  let owner;
  let addr1;

  beforeEach(async function () {
    NumberStorage = await ethers.getContractFactory("NumberStorage");
    [owner, addr1] = await ethers.getSigners();
    numberStorage = await NumberStorage.deploy();
  });

  it("Should store a number and emit NumberStored event", async function () {
    await expect(numberStorage.storeNumber(42))
      .to.emit(numberStorage, 'NumberStored')
      .withArgs(42, owner.address);
  });

  it("Should store and retrieve a number", async function () {
    await numberStorage.connect(owner).storeNumber(42);
    expect(await numberStorage.retrieveNumber()).to.equal(42);
  });

  it("Should return zero for an address that has not stored a number", async function () {
    expect(await numberStorage.connect(addr1).retrieveNumber()).to.equal(0);
  });
});
