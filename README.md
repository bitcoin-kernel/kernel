# bitcoin-kernel

A pristine JavaScript Bitcoin kernel and the layers it power — one consensus
engine, deployed from full node to browser, with no premine, no trusted set, and
no shortcuts. Everything here re-derives Bitcoin's truth from the rules, never
trusting a server or a federation.

## Layout

A monorepo of independently-importable packages (npm workspaces, bundler-free
ESM). Each package is a clean library with its own `package.json`, so any one can
graduate to its own repo or npm publish later without disruption.

```
packages/
  kernel/      consensus engine — block/script/sighash/UTXO validation   (folds in from the engine repo)
  web/         a Bitcoin node in the browser — block cache, txid index,
               source registry (cache/peer/explorer), WebRTC peer mesh,
               in-window DAG verification
  headers/     headers-only verification                                 (planned)
  spv/         SPV / merkle-proof client                                 (planned)
  utreexo/     compact UTXO-set accumulator — full validation, ~KB state (planned)
  swiftsync/   stateless, parallel fast initial validation               (planned)
  wallet/      wallet library                                            (planned)
```

Apps and demos live in **their own repos** (each a deployable gh-pages site with
its own domain), importing these packages — not in this monorepo.

## Distribution: gh-pages as a bundler-free CDN

The default branch is `gh-pages`, and packages are served as static ESM. A demo
imports a library directly by URL, pinned to a release tag — no bundler, no npm
copy step, no staleness:

```js
import { Mesh } from 'https://bitcoin-kernel.github.io/kernel/packages/web/mesh.js';
```

## License

AGPL-3.0-or-later.
