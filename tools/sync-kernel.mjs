// Regenerate packages/kernel — a pinned, CDN-servable snapshot of the consensus
// engine. Replaces the website's build.js silent copy with an explicit, reviewable
// step: re-run this, review the diff, commit. The engine's canonical dev home
// stays bitcoin-desktop/schema; this is a vendored copy.
//
//   PIN: bitcoin-desktop/schema @ b213128 (Fix #70 OP_CODESEPARATOR, PR #71)
//
// Sources (override via env for non-default checkouts):
//   SCHEMA_DIR  — the schema repo (codec/ + schema/*.jsonld)
//   WASM_DIR    — the vendored wasm (secp256k1.wasm + secp-wasm.js)

import { cp, mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';

const SCHEMA = process.env.SCHEMA_DIR ? new URL('file://' + process.env.SCHEMA_DIR + '/') : new URL('../../../bitcoin-desktop/schema/', import.meta.url);
const WASM = process.env.WASM_DIR ? new URL('file://' + process.env.WASM_DIR + '/') : new URL('../../bitcoin-kernel.github.io/engine/wasm/', import.meta.url);
const OUT = new URL('../packages/kernel/', import.meta.url);
const SCHEMAS = ['core', 'proof', 'script', 'chain', 'validate'];

await rm(OUT, { recursive: true, force: true });
await mkdir(new URL('schema/', OUT), { recursive: true });
await mkdir(new URL('wasm/', OUT), { recursive: true });

// codec/ verbatim
await cp(new URL('codec/', SCHEMA), new URL('codec/', OUT), { recursive: true });

// JSON-LD schemas → ESM modules (no fetch / no import attributes in the browser)
for (const k of SCHEMAS) {
  const data = (await readFile(new URL(`schema/${k}.jsonld`, SCHEMA), 'utf8')).trim();
  await writeFile(new URL(`schema/${k}.js`, OUT), `export default ${data};\n`);
}

// wasm: copy, and make the loader fetch the wasm co-located with the MODULE
// (import.meta.url) so it works served from any URL / the CDN.
await copyFile(new URL('secp256k1.wasm', WASM), new URL('wasm/secp256k1.wasm', OUT));
const loader = (await readFile(new URL('secp-wasm.js', WASM), 'utf8'))
  .replace(/loadSecpWasm\(url = [^)]*\)/, "loadSecpWasm(url = new URL('./secp256k1.wasm', import.meta.url).href)");
await writeFile(new URL('wasm/secp-wasm.js', OUT), loader);

// barrel + package.json
await writeFile(new URL('index.js', OUT), `// @bitcoin-kernel/kernel — an independent, zero-dependency implementation of
// Bitcoin's consensus rules. Pure ESM; the same code runs in Node and the browser.
import { Codec } from './codec/codec.js';
import { ScriptEngine } from './codec/script.js';
import { ScriptInterpreter } from './codec/interpreter.js';
import { HeaderEngine } from './codec/headers.js';
import { BlockEngine } from './codec/blocks.js';
import { SpvEngine } from './codec/spv.js';
import core from './schema/core.js';
import proof from './schema/proof.js';
import script from './schema/script.js';
import chain from './schema/chain.js';
import validate from './schema/validate.js';

export { Codec, ScriptEngine, ScriptInterpreter, HeaderEngine, BlockEngine, SpvEngine };
export * from './codec/hash.js';
export * from './codec/secp256k1.js';
export const schemas = { core, proof, script, chain, validate };

export function createKernel() {
  const codec = new Codec(core, proof);
  const scriptEngine = ScriptEngine.fromSchemas(script, chain);
  const limits = script['@graph'].find((n) => n['@id'] === 'btc:scriptLimits');
  const interpreter = new ScriptInterpreter(codec, scriptEngine, limits);
  const headers = HeaderEngine.fromSchemas(codec, chain, validate);
  const blocks = BlockEngine.fromSchemas(codec, chain, validate, script);
  const spv = SpvEngine.fromSchemas(codec, validate);
  return { codec, script: scriptEngine, interpreter, headers, blocks, spv, schemas };
}
export default createKernel;
`);
await writeFile(new URL('package.json', OUT), JSON.stringify({
  name: '@bitcoin-kernel/kernel',
  version: '0.0.1',
  type: 'module',
  license: 'AGPL-3.0-or-later',
  description: "An independent, zero-dependency implementation of Bitcoin's consensus rules. Runs in Node and the browser.",
  exports: { '.': './index.js', './codec/*': './codec/*', './schema/*': './schema/*', './wasm/*': './wasm/*' },
}, null, 2) + '\n');

console.log('packages/kernel regenerated from schema@b213128');
