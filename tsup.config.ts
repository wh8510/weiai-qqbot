import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist/server',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  external: ['better-sqlite3-multiple-ciphers', '@node-rs/argon2', 'silk-wasm'],
});
