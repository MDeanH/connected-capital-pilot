#!/usr/bin/env bash
# Manual deploy for ai-diligence-platform to Netlify (React frontend + Functions)
# This deploys from your LOCAL machine only. It does NOT use or connect to GitHub.
# Run this after making changes locally. Netlify site will NOT auto-deploy from Git.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Installing dependencies (if needed)..."
npm install

echo "==> Building production bundle (React app to dist/)..."
npm run build

NETLIFY="npx --yes netlify-cli@latest"

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]] && [[ ! -f "$HOME/.netlify/state.json" ]]; then
  cat <<'EOF'

Netlify CLI is not authenticated.

ONE-TIME SETUP (run in your terminal):
  cd /Users/friday/Projects/ai-diligence-tool
  npx netlify-cli login

Then re-run this script:
  ./scripts/deploy-netlify.sh

Alternative (no browser): Create a personal access token at
https://app.netlify.com/user/applications#personal-access-tokens
then:
  export NETLIFY_AUTH_TOKEN='your-token-here'
  ./scripts/deploy-netlify.sh

EOF
  exit 1
fi

# For manual deploys (no GitHub connection):
# - First time: This will run "netlify init" which lets you CREATE a new site
#   or link to an existing one. Do NOT choose "connect to Git repository".
# - Use the Netlify dashboard to create the site manually first if you prefer
#   (Deploy manually option), then link here.
if [[ ! -f .netlify/state.json ]]; then
  echo "==> First time: Linking this local folder to a Netlify site..."
  echo "    IMPORTANT: When prompted, create a NEW site or link an existing one."
  echo "    DO NOT connect it to a Git repository (we are doing manual deploys only)."
  $NETLIFY init
fi

echo "==> Deploying to production (dist/ folder + netlify/functions)..."
$NETLIFY deploy --prod --dir=dist

echo ""
echo "==> Done! Your site should be live."
echo "    Visit the URL printed above."
echo ""
echo "    IMPORTANT: In the Netlify dashboard for this site, go to:"
echo "      Site configuration → Environment variables"
echo "    Add: XAI_API_KEY = your actual xAI/Grok API key"
echo "    (required for the Diligence Copilot to work)"
echo ""
echo "    To deploy again later: just run this script (after local changes + build)."
echo "    No GitHub pushes are needed or used for deployment."
