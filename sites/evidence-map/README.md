# Evidence map — standalone Netlify site

The market-predictability evidence network, deployed on its own so it can be
shared as a single link without handing anyone the Connected Capital pilot app.

Live: **https://market-predictability-evidence.netlify.app** (public link,
`noindex`; Netlify site `market-predictability-evidence`, deliberately separate
from the `ai-diligence-platform` pilot site).

`public/index.html` **is** the whole site: one self-contained, dependency-free
file (~252 KB) with the graph JSON baked in. No build step, no bundler, no
functions, no environment variables, no network calls at runtime.

Only `public/` is published. This README and `netlify.toml` stay unpublished on
purpose — the README names the private upstream repo and the pilot.

## Do not edit public/index.html

It is generated. Correct the data upstream
(`MDeanH/financial-market-predictability-evidence`), re-sync into
`reference/market-predictability-evidence/`, then:

```bash
python3 reference/market-predictability-evidence/bake_evidence_network.py
```

That one command rewrites every published copy of the map — this site, the
viz the pilot app serves at `/evidence-network.html`, and the EVIDENCE tab's
JSON. `npm run gate:evidence` fails the build if any of them drift, so a
corrected verdict can never ship behind a stale visualization.

## Deploy

```bash
bash scripts/deploy-evidence-map.sh
```

Manual directory deploy, never from git. Two safeguards are load-bearing:

- **It refuses to run against the pilot site id**, so a deploy here cannot
  touch the Connected Capital release.
- **It deploys from a staging copy in a temp dir, not from this folder.** The
  Netlify CLI resolves config by walking *up* from its working directory, so a
  deploy run anywhere inside this repo finds the pilot's `netlify.toml` and
  bundles the pilot's `netlify/functions`. That happened on the first deploy —
  10 pilot serverless functions went live on this static site, and neither
  `--dir`, `--functions`, nor `cd`-ing here prevented it. Staging outside the
  repo leaves the CLI no parent config to find. Don't "simplify" this away.

## What the site contains

49 claim families over a 198-study ledger (cutoff 2026-07-14, v1.1 corrected):
6 Supported pre-live · 15 Promising · 21 Not established · 6 Ineffective in
tested scope · 1 Methodology — not rated. Nothing is rated "Established
effective" — no family in the public literature clears the live-execution bar.

The underlying ledger covers published academic studies. It carries no client
data, no deal data, and no pilot engine internals.

## Headers

`netlify.toml` sets `noindex` (this is research material from a private repo —
published for direct sharing, not discovery), a `default-src 'none'` CSP that
matches the page's zero external resources, and `must-revalidate` on
`index.html` so a corrected map is never served from cache.
