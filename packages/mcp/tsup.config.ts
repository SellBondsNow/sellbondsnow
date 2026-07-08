import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: false,
  clean: true,
  // Bundle the sellbonds SDK in so `npx sellbonds-mcp` works standalone;
  // viem and the MCP SDK stay external (declared dependencies).
  external: ['viem', '@modelcontextprotocol/sdk', 'zod'],
  noExternal: ['sellbonds'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
