import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/index.ts'],
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  outfile: 'dist/cli/index.js',
  external: [
    'commander',
    'playwright',
    'sharp',
    'svgo',
    'lighthouse',
    'axe-core',
    '@axe-core/playwright',
    'esbuild',
  ],
  sourcemap: true,
  minify: false,
});

console.log('CLI built → dist/cli/index.js');
