import { defineConfig } from 'hardhat/config';
import ethers from '@nomicfoundation/hardhat-ethers';
import matchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import helpers from '@nomicfoundation/hardhat-network-helpers';
import mocha from '@nomicfoundation/hardhat-mocha';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export default defineConfig({
  plugins: [ethers, matchers, helpers, mocha],
  solidity: { version: '0.8.37', path: require.resolve('solc/soljson.js'),
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' } },
  networks: { hardhat: { type: 'edr-simulated', chainType: 'l1' } },
});
