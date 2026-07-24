// @bitcoin-kernel/kernel — an independent, zero-dependency implementation of
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

export function createKernel(network = 'btc:mainnet') {
  const codec = new Codec(core, proof);
  codec.setChainParams(chain['@graph'].find((n) => n['@id'] === network));
  const scriptEngine = ScriptEngine.fromSchemas(script, chain, network);
  const limits = script['@graph'].find((n) => n['@id'] === 'btc:scriptLimits');
  const interpreter = new ScriptInterpreter(codec, scriptEngine, limits);
  const headers = HeaderEngine.fromSchemas(codec, chain, validate, network);
  const blocks = BlockEngine.fromSchemas(codec, chain, validate, script, network);
  const spv = SpvEngine.fromSchemas(codec, validate);
  return { codec, script: scriptEngine, interpreter, headers, blocks, spv, schemas };
}
export default createKernel;
