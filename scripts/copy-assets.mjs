import { cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
await mkdir(new URL('../dist/migrations/', import.meta.url), { recursive: true });
await cp(new URL('../migrations/', import.meta.url), new URL('../dist/migrations/', import.meta.url), { recursive: true });
await cp(new URL('../web/', import.meta.url), new URL('../dist/web/', import.meta.url), { recursive: true });
await build({ entryPoints:['web/account.ts'], bundle:true, minify:true, outfile:'dist/web/account.js', platform:'browser', format:'esm', target:'es2022' });
