#!/bin/bash
# Auto-retry the US Market data refresh until all FRED series are present.
#
# Re-runs load_us_market.py on an interval. The loader tries, per series:
#   official FRED API (if FRED_API_KEY set) -> fredgraph.csv scrape ->
#   no-key agency fallback (Treasury / BLS / NY Fed).
# It writes src/us-market.json ONLY on a strict no-regression improvement.
# When the file improves, this script rebuilds, commits, and pushes (Netlify
# auto-deploys from main). Stops when zero series are missing, or after MAX.
#
# Usage:
#   FRED_API_KEY=your32charkey bash scripts/retry_us_market.sh    # fastest: fills all 8
#   bash scripts/retry_us_market.sh                               # no key: fills what agencies allow + waits for FRED
#
# Env: INTERVAL (seconds between attempts, default 1500=25min), MAX (max attempts, default 20)

set -u
cd "$(dirname "$0")/.." || exit 1
PY=".venv/bin/python"
NODE_BIN="$PWD/.node-local/bin"
INTERVAL="${INTERVAL:-1500}"
MAX="${MAX:-20}"
LOG=/tmp/retry_us_market.log

missing_count() { "$PY" -c "import json;print(len(json.load(open('src/us-market.json'))['missing']))" 2>/dev/null || echo 99; }

echo "[$(date '+%F %T')] retry start — key:$([ -n "${FRED_API_KEY:-}" ] && echo yes || echo no) interval:${INTERVAL}s max:$MAX missing:$(missing_count)" | tee -a "$LOG"

for attempt in $(seq 1 "$MAX"); do
  before=$(git rev-parse HEAD:src/us-market.json 2>/dev/null)
  "$PY" scripts/load_us_market.py >>"$LOG" 2>&1
  miss=$(missing_count)

  # did the tracked file actually change?
  if ! git diff --quiet src/us-market.json 2>/dev/null; then
    echo "[$(date '+%F %T')] attempt $attempt: improved -> missing now $miss; building + deploying" | tee -a "$LOG"
    PATH="$NODE_BIN:$PATH" npm run build >>"$LOG" 2>&1
    git add src/us-market.json
    git commit -q -m "US Market: refresh FRED/agency series (missing now $miss)

Auto-refresh via scripts/retry_us_market.sh — load_us_market.py backfilled
series from the official FRED API and/or no-key agency sources (Treasury 10y,
BLS CPI/payrolls/unemployment, NY Fed EFFR). Non-destructive: written only
because it strictly improved coverage.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
    git push origin main >>"$LOG" 2>&1 && echo "[$(date '+%F %T')] pushed." | tee -a "$LOG"
  else
    echo "[$(date '+%F %T')] attempt $attempt: no improvement (missing $miss); FRED CSV still blocked & no/over-key" | tee -a "$LOG"
  fi

  if [ "$miss" = "0" ]; then
    echo "[$(date '+%F %T')] DONE — all series present." | tee -a "$LOG"; touch /tmp/retry_us_market_done; exit 0
  fi
  [ "$attempt" -lt "$MAX" ] && sleep "$INTERVAL"
done
echo "[$(date '+%F %T')] stopped after $MAX attempts; $(missing_count) still missing. Set FRED_API_KEY for an instant full fill." | tee -a "$LOG"
touch /tmp/retry_us_market_done
