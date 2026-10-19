// Regenerates ui/vendor from node_modules. Run after upgrading trystero or hls.js:
//   npm run vendor
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
mkdirSync(join(root, 'ui/vendor'), { recursive: true });
mkdirSync(join(root, 'ui/fonts'), { recursive: true });
await build({
  entryPoints: [join(root, 'tools/vendor-entry.mjs')],
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome130', minify: true,
  outfile: join(root, 'ui/vendor/trystero.mjs'), legalComments: 'eof'
});
copyFileSync(require.resolve('hls.js/dist/hls.min.js'), join(root, 'ui/player/hls.min.js'));
const font = dirname(require.resolve('@fontsource/instrument-serif/package.json'));
for (const f of ['instrument-serif-latin-400-normal.woff2', 'instrument-serif-latin-400-italic.woff2']) copyFileSync(join(font, 'files', f), join(root, 'ui/fonts', f));
console.log('vendor files rebuilt');
