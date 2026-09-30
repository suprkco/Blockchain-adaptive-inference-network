import { network } from 'hardhat';
const { ethers } = await network.create('hardhat');

async function main() {
    // Déploiement du contrat Lock
    const Lock = await ethers.getContractFactory("Lock");
    const currentTimestampInSeconds = Math.round(Date.now() / 1000);
    const unlockTime = currentTimestampInSeconds + 60;
    const lockedAmount = ethers.parseEther("0.001");

    const lock = await Lock.deploy(unlockTime, { value: lockedAmount });
    await lock.waitForDeployment();

    console.log(
        `Lock with ${ethers.formatEther(
            lockedAmount
        )} ETH and unlock timestamp ${unlockTime} deployed to ${await lock.getAddress()}`
    );

    // Déploiement du contrat NumberStorage
    const NumberStorage = await ethers.getContractFactory("NumberStorage");
    const numberStorage = await NumberStorage.deploy();
    await numberStorage.waitForDeployment();

    console.log("NumberStorage deployed to:", await numberStorage.getAddress());

    // Déploiement du contrat Greeter
    const Greeter = await ethers.getContractFactory("Greeter");
    const greeter = await Greeter.deploy("Hello, local chain!");
    await greeter.waitForDeployment();

    console.log("Greeter deployed to:", await greeter.getAddress());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
