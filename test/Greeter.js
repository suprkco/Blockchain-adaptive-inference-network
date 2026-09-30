import { network } from 'hardhat';
const { ethers, networkHelpers } = await network.create('hardhat');
const { time, loadFixture } = networkHelpers;
import { expect } from 'chai';

describe("Greeter contract", function () {
    let Greeter;
    let greeter;
    let owner;
    let addr1;
    let addr2;
    let addrs;

    beforeEach(async function () {
        Greeter = await ethers.getContractFactory("Greeter");
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        greeter = await Greeter.deploy("Hello, world!");
    });

    describe("Deployment", function () {
        it("Should set the right greeting", async function () {
            expect(await greeter.greet()).to.equal("Hello, world!");
        });

        it("Should set the right owner", async function () {
            expect(await greeter.owner()).to.equal(owner.address);
        });
    });

    it("should return the initial greeting", async () => {
        let greeting = await greeter.greet();
        expect(greeting).to.equal("Hello, world!"); // Use the expect assertion for consistency
    });

    it("should change the greeting", async () => {
        await greeter.setGreeting("Bonjour");
        let greeting = await greeter.greet();
        expect(greeting).to.equal("Bonjour"); // Use the expect assertion for consistency
    });
});
