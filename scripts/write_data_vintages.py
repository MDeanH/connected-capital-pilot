#!/usr/bin/env python3
"""
Write public/data-vintages.json — the manifest of what data vintage the site
currently ships, per dataset. The /api/data-status Netlify function compares
these against each source's latest published marker to drive the green/red
freshness dots on the Home page.

Derives vintages from the local data files where possible (run after any
rebake, commit the result alongside the data).
"""

from __future__ import annotations

import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data-vintages.json"


def zillow_latest(fname: str) -> str | None:
    p = ROOT / "data" / fname
    if not p.exists():
        return None
    header = p.open().readline().strip().split(",")
    dates = [c.strip('"') for c in header if c.strip('"')[:4].isdigit() and "-" in c]
    return dates[-1] if dates else None


def main():
    crime_year = None
    try:
        crime_year = json.loads((ROOT / "public/crime-stats.json").read_text())["year"]
    except Exception:
        pass
    usmkt_asof = None
    try:
        usmkt_asof = json.loads((ROOT / "src/us-market.json").read_text())["asof"]
    except Exception:
        pass

    today = datetime.date.today().isoformat()
    vintages = {
        "generated": today,
        "datasets": [
            {"id": "zhvi", "name": "Zillow home values (ZHVI)",
             "vintage": zillow_latest("zillow_zhvi_metro_raw.csv"), "check": "zillow_zhvi"},
            {"id": "zori", "name": "Zillow rents (ZORI)",
             "vintage": zillow_latest("zori_msa.csv"), "check": "zillow_zori"},
            {"id": "inventory", "name": "Zillow inventory / market heat",
             "vintage": zillow_latest("heat_inv_msa.csv"), "check": "zillow_inv"},
            {"id": "crime", "name": "FBI crime (UCR/NIBRS)",
             "vintage": str(crime_year) if crime_year else None, "check": "fbi_next_year"},
            {"id": "usmarket", "name": "US macro series (FRED)",
             "vintage": usmkt_asof, "check": "age_45d"},
            {"id": "hmda", "name": "HMDA mortgage data (CFPB)",
             "vintage": "2024", "check": "hmda_next_year"},
            {"id": "irs", "name": "IRS county migration",
             "vintage": "2022-23", "check": "irs_next_vintage"},
            {"id": "permits", "name": "Census building permits",
             "vintage": "2025", "check": "bps_next_year"},
            # bea vintage = date we downloaded CAINC1.zip (probe compares Last-Modified)
            {"id": "bea", "name": "BEA county income",
             "vintage": "2026-06-09", "check": "bea_modified"},
            {"id": "nri", "name": "FEMA hazard risk (NRI)",
             "vintage": "2026-06-09", "check": "nri_modified"},
            {"id": "nfip", "name": "FEMA flood claims (NFIP)",
             "vintage": "2026-06-09", "check": "nfip_refresh"},
        ],
    }
    OUT.write_text(json.dumps(vintages, separators=(",", ":")))
    print(f"Wrote {OUT}{tracked_note(OUT)}:")
    for d in vintages["datasets"]:
        print(f"  {d['id']:10s} vintage={d['vintage']}")

    update_landing_page(vintages)


def tracked_note(path: Path) -> str:
    """' (untracked in git — not shipped from this branch)' if git doesn't track path.

    The parent line tracks and deploys both JSON manifests this script writes;
    the deal-product line (cc-data-merge) removed them. Saying which case we're
    in keeps a rebake's output honest on either line.
    """
    import subprocess

    try:
        r = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "--error-unmatch", str(path.relative_to(ROOT))],
            capture_output=True,
        )
        return "" if r.returncode == 0 else " (untracked in git — not shipped from this branch)"
    except Exception:
        return ""


def update_landing_page(vintages: dict):
    """Sync the landing page's baked numbers with the current data.

    This is the 'connector': every rebake ends with this script, which derives
    the live stats and patches public/how-it-works.html in place (hero
    count-up stats anchored by their labels, plus every prose/tooltip mention
    of the previous values). Also writes public/site-stats.json as the
    machine-readable source of truth.
    """
    import re

    stats: dict = {"generated": vintages["generated"]}
    try:
        stats["markets"] = len(json.loads((ROOT / "src/metros-list.json").read_text()))
    except Exception:
        stats["markets"] = None
    try:
        crime = json.loads((ROOT / "public/crime-stats.json").read_text())
        stats["crimeMarkets"] = len(crime["markets"])
        stats["crimeYear"] = crime["year"]
    except Exception:
        stats["crimeMarkets"] = stats["crimeYear"] = None
    try:
        stats["contextMarkets"] = len(json.loads((ROOT / "public/market-context.json").read_text())["markets"])
    except Exception:
        stats["contextMarkets"] = None
    stats["vintagesTracked"] = len(vintages["datasets"])
    stats_out = ROOT / "public/site-stats.json"
    stats_out.write_text(json.dumps(stats, separators=(",", ":")))
    print(f"Wrote {stats_out}{tracked_note(stats_out)}")

    page = ROOT / "public" / "how-it-works.html"
    if not page.exists():
        return
    s = page.read_text()
    orig = s

    # hero count-up stats, anchored by their label text (order-independent)
    anchors = [
        ("selectable US markets", stats["markets"]),
        ("markets with FBI crime", stats["crimeMarkets"]),
        ("markets with the 8-dataset", stats["contextMarkets"]),
        ("dataset vintages tracked", stats["vintagesTracked"]),
    ]

    # Anchor absence must be LOUD, never a silent "already in sync". The
    # deal-product line's hero shows engine stats, not data stats — there the
    # right outcome is an explicit skip. A PARTIAL match means the page was
    # edited out from under us: fail the rebake and name the missing anchors.
    def anchor_pat(label: str) -> re.Pattern:
        return re.compile(r'data-n="(\d+)">([\d,]+)(</div>\s*<div class="stat-lbl">' + re.escape(label) + ")")

    present = [label for label, _ in anchors if anchor_pat(label).search(s)]
    if not present:
        print("landing page carries no data-stat anchors (deal-product line) — hero patching skipped")
        return
    if len(present) < len(anchors):
        missing = [label for label, _ in anchors if label not in present]
        import sys
        sys.exit(f"ERROR: landing page has SOME data-stat anchors but not all — missing: {missing}. "
                 "Fix public/how-it-works.html (or this script's anchor list) before rebaking.")

    old_vals: dict[str, int] = {}
    for label, new in anchors:
        if not new:
            continue
        pat = anchor_pat(label)
        m = pat.search(s)
        if m:
            old_vals[label] = int(m.group(1))
            s = pat.sub(f'data-n="{new}">{new:,}\\3', s, count=1)

    # propagate every prose/tooltip mention of the OLD values (formatted with commas)
    for label, new in anchors:
        old = old_vals.get(label)
        if new and old and old != new:
            s = s.replace(f"{old:,}", f"{new:,}")

    # crime vintage year in prose/tooltips ("UCR/NIBRS, 2025 vintage", "FBI 2025")
    if stats["crimeYear"]:
        y = str(stats["crimeYear"])
        s = re.sub(r"(UCR/NIBRS, )\d{4}( vintage)", rf"\g<1>{y}\g<2>", s)
        s = re.sub(r"(FBI )\d{4}\b", rf"\g<1>{y}", s)

    if s != orig:
        page.write_text(s)
        print(f"Landing page synced: {[f'{l}: {old_vals.get(l)}→{n}' for l, n in anchors if old_vals.get(l) != n and n]}")
    else:
        print("Landing page already in sync.")


if __name__ == "__main__":
    main()
