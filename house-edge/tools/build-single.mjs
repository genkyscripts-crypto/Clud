/*
 * Bundles index.html, the stylesheet and every script into one self-contained
 * HTML file you can share or host anywhere.
 *
 *   node tools/build-single.mjs   → dist/house-edge.html
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

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'house-edge.html');
writeFileSync(out, inline);
console.log('bundle written to ' + out + ' (' + Math.round(inline.length / 1024) + ' KB)');
