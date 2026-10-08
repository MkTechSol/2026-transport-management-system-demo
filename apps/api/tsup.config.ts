import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate.ts', 'src/seed/cli.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  noExternal: ['@gasman/shared'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
