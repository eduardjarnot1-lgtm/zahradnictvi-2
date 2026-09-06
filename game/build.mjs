// Tiny bundler: the game ships as one self-contained HTML file (it has to run
// from file://, from Netlify and as an Artifact), but the source is real ES
// modules so the simulation can be tested in node without a browser.
//
// Each module becomes its own IIFE in a registry, so module scopes stay separate
// — two modules destructuring `width: W` from TUNING must not collide.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS } from './src/levels.js';
import { validateAll } from './src/validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Dependency order. A module may only import from ones above it.
const ORDER = [
  'tuning', 'rng', 'rules', 'physics', 'nav', 'tilemap', 'maps', 'levels', 'validate',
  'gait', 'figure',
  'sim', 'replay', 'save', 'fsm', 'audio', 'input', 'art', 'render', 'main'
];

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+)\.js';?\s*$/;
const EXPORT_DECL_RE = /^export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;

// Import statements may wrap across lines; fold them back onto one line before
// parsing, so source formatting is free to be readable.
function foldImports(source) {
  return source.replace(/^import\s*\{[^}]*\}\s*from\s*'[^']+';?$/gms, (match) =>
    match.replace(/\s*\n\s*/g, ' ').replace(/\{\s+/, '{ ').replace(/\s+\}/, ' }')
  );
}

function transform(name, source) {
  const exported = [];
  const lines = foldImports(source).split('\n');
  const out = [];

  for (const line of lines) {
    const asImport = line.match(IMPORT_RE);
    if (asImport) {
      const names = asImport[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [original, alias] = s.split(/\s+as\s+/).map((t) => t.trim());
          return alias ? `${original}: ${alias}` : original;
        });
      // A module missing from ORDER bundles into a file that parses, loads,
      // and then reads properties off undefined the moment it runs. Catching
      // it here costs a line; catching it in a browser costs an afternoon.
      const from = asImport[2];
      if (ORDER.indexOf(from) < 0) {
        throw new Error(`${name}.js imports ./${from}.js, which is not in build.mjs ORDER`);
      }
      if (ORDER.indexOf(from) >= ORDER.indexOf(name)) {
        throw new Error(`${name}.js imports ./${from}.js, which ORDER places after it`);
      }
      out.push(`  const { ${names.join(', ')} } = __mod.${from};`);
      continue;
    }
    if (/^import\s/.test(line)) {
      throw new Error(`${name}.js: unsupported import form:\n  ${line}`);
    }
    if (/^export\s+default/.test(line)) {
      throw new Error(`${name}.js: default exports are not supported by the bundler`);
    }
    const asExport = line.match(EXPORT_DECL_RE);
    if (asExport) {
      exported.push(asExport[2]);
      out.push(`  ${line.replace(/^export\s+/, '')}`);
      continue;
    }
    if (/^export\s*\{/.test(line)) {
      throw new Error(`${name}.js: use "export const/function", not an export list`);
    }
    out.push(line ? `  ${line}` : '');
  }

  return [
    `__mod.${name} = (function () {`,
    ...out,
    `  return { ${exported.join(', ')} };`,
    '})();'
  ].join('\n');
}

function bundle() {
  const parts = ORDER.map((name) => {
    const file = path.join(here, 'src', `${name}.js`);
    return transform(name, fs.readFileSync(file, 'utf8').trimEnd());
  });

  return [
    '(function () {',
    '"use strict";',
    'var __mod = {};',
    ...parts,
    '__mod.main.boot();',
    '})();'
  ].join('\n');
}

// --- level validation is part of the build, not an optional extra ------------
const report = validateAll(LEVELS);
for (const result of report.results) {
  for (const warning of result.warnings) console.warn(`  warn  L${result.id}: ${warning}`);
  for (const error of result.errors) console.error(`  ERROR L${result.id}: ${error}`);
}
if (!report.ok) {
  console.error(`\nBuild aborted: ${report.errorCount} level error(s).`);
  process.exit(1);
}
console.log(`✓ ${report.results.length} levels valid`);

if (process.argv.includes('--validate-only')) process.exit(0);

const shell = fs.readFileSync(path.join(here, 'shell.html'), 'utf8');
if (!shell.includes('/*BUNDLE*/')) throw new Error('shell.html has no /*BUNDLE*/ placeholder');

const html = shell.replace('/*BUNDLE*/', () => bundle());
const outFile = path.join(here, 'index.html');
fs.writeFileSync(outFile, html);
console.log(`✓ built ${path.relative(process.cwd(), outFile)} (${(html.length / 1024).toFixed(1)} KB)`);

// The artifact copy has no <!DOCTYPE>/<head>/<body> — those come from the host.
const inner = html.match(/<body>([\s\S]*?)<\/body>/)[1].trim();
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const artifactFile = path.join(here, 'dist', 'artifact.html');
fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
fs.writeFileSync(artifactFile, `${title}\n${style}\n\n${inner}\n`);
console.log(`✓ built ${path.relative(process.cwd(), artifactFile)}`);
