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
    print(f"Wrote {OUT}:")
    for d in vintages["datasets"]:
        print(f"  {d['id']:10s} vintage={d['vintage']}")


if __name__ == "__main__":
    main()
