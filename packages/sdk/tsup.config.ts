import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: { entry: { index: 'src/index.ts' } },
  // Bundle the deployments JSON in. viem stays external (declared dependency).
  external: ['viem'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
