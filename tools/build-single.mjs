/*
 * Bundles index.html, the stylesheet and every script into one self-contained
 * HTML file you can share or host anywhere.
 *
 *   node tools/build-single.mjs                 → dist/zero-to-armory.html
 *   node tools/build-single.mjs --fragment OUT  → body-only fragment (for hosts that add their own <html>/<head>)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const inline = html
  .replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, href) => '<style>\n' + readFileSync(join(root, href), 'utf8') + '</style>')
  .replace(/<script src="(js\/[^"]+)"><\/script>\n?/g, (_, src) => {
    const code = readFileSync(join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script');
    return '<script>\n/* ' + src + ' */\n' + code + '</script>\n';
  });

const args = process.argv.slice(2);
const fragIdx = args.indexOf('--fragment');
if (fragIdx !== -1) {
  const out = args[fragIdx + 1];
  if (!out) throw new Error('--fragment needs an output path');
  const head = inline.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\n?/, '').replace(/<meta name="viewport"[^>]*>\n?/, '');
  const body = inline.match(/<body>([\s\S]*?)<\/body>/)[1];
  writeFileSync(out, head.trim() + '\n' + body.trim() + '\n');
  console.log('fragment written to ' + out);
} else {
  mkdirSync(join(root, 'dist'), { recursive: true });
  const out = join(root, 'dist', 'zero-to-armory.html');
  writeFileSync(out, inline);
  console.log('bundle written to ' + out + ' (' + Math.round(inline.length / 1024) + ' KB)');
}
