#!/usr/bin/env bash
# Deploy the standalone evidence-map site (sites/evidence-map/) to Netlify.
#
# Manual directory deploy from this machine only — it does NOT use, push to, or
# read from git, and it is deliberately a DIFFERENT Netlify site from the
# Connected Capital pilot. The pilot site id is hard-blocked below so a mistyped
# --site can never publish the evidence map over the client release.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DIR="sites/evidence-map/public"                        # ONLY this folder is published
PILOT_SITE_ID="90b76167-9ac0-4802-bbef-c8efbc5cb536"   # ai-diligence-platform — NEVER deploy here
# market-predictability-evidence — the evidence map's own site
SITE_ID="${EVIDENCE_MAP_SITE_ID:-1dd929b5-b16c-42de-bad4-13117a9f1a17}"

if [[ -n "$SITE_ID" && "$SITE_ID" == "$PILOT_SITE_ID" ]]; then
  echo "REFUSING: EVIDENCE_MAP_SITE_ID is the Connected Capital pilot site." >&2
  echo "The evidence map deploys to its own site. Aborting." >&2
  exit 1
fi

# The map must be in sync with its source data before it is published anywhere.
echo "==> Verifying the evidence map is baked from current source data..."
python3 reference/market-predictability-evidence/bake_evidence_network.py --check

[[ -f "$DIR/index.html" ]] || { echo "missing $DIR/index.html — run the bake" >&2; exit 1; }

NETLIFY="npx --yes netlify-cli@latest"

# Ask the CLI whether it is authenticated rather than guessing where it keeps
# credentials — the path is platform-specific (macOS: ~/Library/Preferences/
# netlify/config.json, not ~/.netlify), and guessing wrong fails a working setup.
if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]] && ! $NETLIFY api getCurrentUser --data '{}' >/dev/null 2>&1; then
  cat <<'EOF'

Netlify CLI is not authenticated. One-time setup:

  npx netlify-cli login

or create a personal access token at
https://app.netlify.com/user/applications#personal-access-tokens and:

  export NETLIFY_AUTH_TOKEN='your-token-here'

EOF
  exit 1
fi

# Deploy from a STAGING COPY outside the repo. This is the whole trick, and it
# is not optional: the Netlify CLI resolves project config by walking UP from
# its working directory until it finds netlify.toml / .netlify/state.json. Run
# anywhere inside this repo, it finds the pilot's config and bundles the
# pilot's netlify/functions — 10 serverless functions went live on this static
# site that way, and neither --dir, --functions, nor cd'ing into
# sites/evidence-map stopped it, because the walk-up happens regardless.
#
# Staging in a temp dir gives the CLI no parent config to find: what is in the
# staging dir is exactly what deploys.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/public" "$STAGE/empty-functions"
cp "$ROOT/$DIR"/* "$STAGE/public/"
cp "$ROOT/sites/evidence-map/netlify.toml" "$STAGE/netlify.toml"

echo "==> Staged for deploy (this is the complete published payload):"
( cd "$STAGE/public" && ls -la )

# --site is always explicit: the repo root is LINKED to the pilot site, so an
# unqualified `netlify deploy` would target the client release.
# --no-build is required, not cosmetic: without it the CLI runs framework
# detection and stops on an interactive "Multiple possible build commands
# found" prompt. Nothing here compiles.
echo "==> Deploying to site $SITE_ID (production)..."
cd "$STAGE"
$NETLIFY deploy --dir=public --functions=empty-functions --no-build --prod --site="$SITE_ID"

echo ""
echo "==> Done. Re-run after any data correction + re-bake."
