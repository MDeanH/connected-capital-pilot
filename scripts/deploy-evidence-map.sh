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

DIR="sites/evidence-map"
PILOT_SITE_ID="90b76167-9ac0-4802-bbef-c8efbc5cb536"   # ai-diligence-platform — NEVER deploy here
SITE_ID="${EVIDENCE_MAP_SITE_ID:-}"

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

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]] && [[ ! -f "$HOME/.netlify/state.json" ]]; then
  cat <<'EOF'

Netlify CLI is not authenticated. One-time setup:

  npx netlify-cli login

or create a personal access token at
https://app.netlify.com/user/applications#personal-access-tokens and:

  export NETLIFY_AUTH_TOKEN='your-token-here'

EOF
  exit 1
fi

if [[ -z "$SITE_ID" ]]; then
  echo "==> No EVIDENCE_MAP_SITE_ID set — creating/linking a site interactively."
  echo "    Choose 'Create & configure a new project'. Do NOT connect it to git."
  $NETLIFY deploy --dir="$DIR" --prod
else
  echo "==> Deploying $DIR to site $SITE_ID (production)..."
  $NETLIFY deploy --dir="$DIR" --prod --site="$SITE_ID"
fi

echo ""
echo "==> Done. Re-run after any data correction + re-bake."
