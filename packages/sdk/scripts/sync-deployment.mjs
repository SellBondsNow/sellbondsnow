// Bake a forge deployment into the SDK + the public deployments file.
//
// Usage: node scripts/sync-deployment.mjs [path-to-forge-deployment.json]
// Default source: packages/contracts/deployments/base-sepolia.json
//
// The forge script (DeployBase.s.sol) writes { chainId, chain, deployer,
// deployedAt, contracts:{...} }. This merges those addresses into:
//   - packages/sdk/src/deployments/<chain>.json   (bundled into the SDK build)
//   - apps/web/public/deployments/<chain>.json     (the public surface agents fetch)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const src = process.argv[2] || join(repoRoot, 'packages/contracts/deployments/base-sepolia.json');
const forge = JSON.parse(readFileSync(src, 'utf8'));
const chain = forge.chain || 'base-sepolia';

const sdkPath = join(repoRoot, 'packages/sdk/src/deployments', `${chain}.json`);
const publicPath = join(repoRoot, 'apps/web/public/deployments', `${chain}.json`);

const base = JSON.parse(readFileSync(sdkPath, 'utf8'));

const merged = {
  ...base,
  chainId: forge.chainId ?? base.chainId,
  chain,
  deployed: true,
  deployer: forge.deployer ?? base.deployer,
  deployedAt: forge.deployedAt,
  contracts: { ...base.contracts, ...forge.contracts },
};

const json = JSON.stringify(merged, null, 2) + '\n';
writeFileSync(sdkPath, json);
writeFileSync(publicPath, json);

console.log(`Synced ${chain} deployment into:`);
console.log(`  ${sdkPath}`);
console.log(`  ${publicPath}`);
console.log('Contracts:');
for (const [k, v] of Object.entries(merged.contracts)) console.log(`  ${k.padEnd(28)} ${v}`);
console.log('\nNext: pnpm --filter sellbonds build');
