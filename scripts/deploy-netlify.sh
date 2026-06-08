#!/usr/bin/env bash
# Deploy ai-diligence-platform to Netlify (React + Functions)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Installing dependencies (if needed)..."
npm install

echo "==> Building production bundle..."
npm run build

NETLIFY="npx --yes netlify-cli@latest"

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]] && [[ ! -f "$HOME/.netlify/state.json" ]]; then
  cat <<'EOF'

Netlify CLI is not authenticated.

ONE-TIME SETUP:
  cd /Users/friday/Projects/ai-diligence-tool
  npx netlify-cli login

Then re-run this script:
  ./scripts/deploy-netlify.sh

Or set a personal access token:
  export NETLIFY_AUTH_TOKEN='your-token'
  ./scripts/deploy-netlify.sh

EOF
  exit 1
fi

if [[ ! -f .netlify/state.json ]]; then
  echo "==> Linking this folder to a Netlify site (first run)..."
  $NETLIFY init
fi

echo "==> Deploying to production (dist + netlify/functions)..."
$NETLIFY deploy --prod --dir=dist

echo ""
echo "==> Done! Your site should be live."
echo "    Visit the URL printed above."
echo ""
echo "    Don't forget to set the XAI_API_KEY environment variable"
echo "    in the Netlify dashboard (Site settings → Environment variables)"
echo "    so the Diligence Copilot can call Grok."
