#!/usr/bin/env python3
"""Bake the evidence-network graph JSON into every derived copy in the app.

Reads financial-market-predictability-families.json and
financial-market-predictability-evidence.csv (same directory), builds the
graph payload (family / study / asset-hub nodes plus evidence edges), and
writes all four artifacts derived from that data:

  reference/market-predictability-evidence/evidence-network.html  (the source viz)
  public/evidence-network.html                          (the viz served by the app)
  sites/evidence-map/index.html                    (the standalone Netlify site)
  src/data/evidence-families.json                                 (the EVIDENCE tab)

Writing all four here is the point: the served copy used to be a manual
`cp`, so a re-bake after a data correction silently left the deployed
visualization stale. Every new place the map gets published belongs on this
list, or it becomes the next stale copy.

Run after any correction to the CSV/JSON so everything re-syncs:

    python3 bake_evidence_network.py

Verify without writing (used by `npm run gate:evidence` via its Node twin):

    python3 bake_evidence_network.py --check
"""

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FAMILIES_JSON = HERE / "financial-market-predictability-families.json"
EVIDENCE_CSV = HERE / "financial-market-predictability-evidence.csv"
HTML_FILE = HERE / "evidence-network.html"
PUBLIC_HTML = ROOT / "public" / "evidence-network.html"
STANDALONE_HTML = ROOT / "sites" / "evidence-map" / "index.html"
APP_FAMILIES = ROOT / "src" / "data" / "evidence-families.json"

START_MARK = "/*==GRAPH-DATA-START==*/"
END_MARK = "/*==GRAPH-DATA-END==*/"

# Display order + labels for the coarse asset buckets (first token of asset_tags).
HUB_LABELS = {
    "equities": "Equities",
    "rates": "Rates",
    "credit": "Credit",
    "fx": "FX",
    "commodities": "Commodities",
    "derivatives": "Derivatives",
    "volatility": "Volatility",
    "microstructure": "Microstructure",
    "crypto": "Crypto",
    "real-estate": "Real estate",
    "private-markets": "Private markets",
    "cross-asset": "Cross-asset",
    "methodology": "Methodology",
}

NATIVE_RESULT_MAX = 420  # keep tooltips readable and the payload lean


def inputs_sha256():
    """Fingerprint of the two source files, stamped into the baked payload.

    Length-prefixed per file so no pair of inputs can collide by shifting
    bytes across the boundary. The build gate recomputes this from the
    sources and compares it to what is baked into the served HTML — that is
    what catches "data was corrected but nobody re-baked".
    """
    h = hashlib.sha256()
    for path in (FAMILIES_JSON, EVIDENCE_CSV):
        blob = path.read_bytes()
        h.update(f"{path.name}:{len(blob)}:".encode("utf-8"))
        h.update(blob)
    return h.hexdigest()


def tags_of(raw):
    return [t.strip() for t in (raw or "").split(";") if t.strip()]


def truncate(text, limit):
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def build_graph():
    families_raw = json.loads(FAMILIES_JSON.read_text(encoding="utf-8"))
    with EVIDENCE_CSV.open(encoding="utf-8", newline="") as fh:
        studies_raw = list(csv.DictReader(fh))

    studies_by_id = {row["study_id"]: row for row in studies_raw}

    missing = [
        (fam["claim_id"], eid)
        for fam in families_raw
        for eid in fam.get("evidence_ids", [])
        if eid not in studies_by_id
    ]
    if missing:
        raise SystemExit(
            f"evidence_ids with no matching study_id in the CSV: {missing}"
        )

    cited_by = {}
    for fam in families_raw:
        for eid in fam.get("evidence_ids", []):
            cited_by.setdefault(eid, []).append(fam["claim_id"])

    families = []
    for fam in families_raw:
        tags = tags_of(fam.get("asset_tags"))
        families.append(
            {
                "id": fam["claim_id"],
                "label": fam.get("label", fam["claim_id"]),
                "verdict": fam.get("verdict", ""),
                "confidence": fam.get("confidence", ""),
                "scores": {k: fam.get(k, "U") for k in ("p", "e", "r", "i", "t", "b")},
                "tags": tags,
                "hub": tags[0] if tags else "cross-asset",
                "target": fam.get("target", ""),
                "horizon": fam.get("horizon", ""),
                "scope": fam.get("scope", ""),
                "summary": fam.get("summary", ""),
                "positive": fam.get("positive_evidence", ""),
                "negative": fam.get("negative_evidence", ""),
                "caveat": fam.get("key_caveat", ""),
                "evidence": list(fam.get("evidence_ids", [])),
            }
        )

    studies = []
    for row in studies_raw:
        tags = tags_of(row.get("asset_tags"))
        studies.append(
            {
                "id": row["study_id"],
                "title": row.get("title", ""),
                "year": row.get("year", ""),
                "authors": row.get("authors", ""),
                "venue": row.get("venue", ""),
                "url": row.get("url", ""),
                "asset_class": row.get("asset_class", ""),
                "tags": tags,
                "hub": tags[0] if tags else "cross-asset",
                "stage": row.get("evidence_stage", ""),
                "result": row.get("result_tag", ""),
                "native": truncate(row.get("native_result"), NATIVE_RESULT_MAX),
                "limitation": truncate(row.get("key_limitation"), NATIVE_RESULT_MAX),
                "pconf": row.get("protocol_confidence", ""),
                "cited_by": cited_by.get(row["study_id"], []),
            }
        )

    hub_members = Counter(f["hub"] for f in families)
    hub_studies = Counter(s["hub"] for s in studies)
    hubs = [
        {
            "id": hub,
            "label": HUB_LABELS.get(hub, hub.replace("-", " ").title()),
            "families": hub_members.get(hub, 0),
            "studies": hub_studies.get(hub, 0),
        }
        for hub in HUB_LABELS
        if hub_members.get(hub) or hub_studies.get(hub)
    ]

    n_links = sum(len(f["evidence"]) for f in families)
    multi = sum(1 for ids in cited_by.values() if len(ids) > 1)
    orphans = sum(1 for s in studies if not s["cited_by"])

    graph = {
        "meta": {
            "families": len(families),
            "studies": len(studies),
            "links": n_links,
            "multi_cited": multi,
            "orphan_studies": orphans,
            "source": [FAMILIES_JSON.name, EVIDENCE_CSV.name],
            "inputs_sha256": inputs_sha256(),
        },
        "hubs": hubs,
        "families": families,
        "studies": studies,
    }
    print(
        f"graph: {len(families)} families, {len(studies)} studies "
        f"({orphans} uncited), {n_links} evidence links "
        f"({multi} studies cited by >1 family), {len(hubs)} asset hubs"
    )
    return graph


def bake_html(graph):
    """Return evidence-network.html with the payload re-baked (no write)."""
    html = HTML_FILE.read_text(encoding="utf-8")
    start = html.find(START_MARK)
    end = html.find(END_MARK)
    if start == -1 or end == -1 or end < start:
        raise SystemExit(f"GRAPH-DATA markers not found in {HTML_FILE.name}")

    payload = json.dumps(graph, ensure_ascii=True, separators=(",", ":"))
    # A raw "<" in the payload could re-enter HTML parsing ("</script", and
    # "<!--" + "<script" puts the parser in the escaped-script-data state), so
    # escape every "<" — "<" is the same character to JSON.parse.
    payload = payload.replace("<", "\\u003c")
    # Neutralize any literal bake marker inside data values: both markers end
    # in "*/", and "\/" is a legal JSON escape for "/", so marker searches
    # (here and in the page JS) can never match inside the payload.
    payload = payload.replace("*/", "*\\/")

    return html[: start + len(START_MARK)] + payload + html[end:], len(payload)


def artifacts():
    """Every derived file and the exact bytes it must contain."""
    baked, size = bake_html(build_graph())
    baked_bytes = baked.encode("utf-8")
    families_bytes = FAMILIES_JSON.read_bytes()
    return size, [
        (HTML_FILE, baked_bytes),
        (PUBLIC_HTML, baked_bytes),
        (STANDALONE_HTML, baked_bytes),
        (APP_FAMILIES, families_bytes),
    ]


def rel(path):
    try:
        return path.relative_to(ROOT)
    except ValueError:
        return path


def write():
    size, targets = artifacts()
    print(f"baked {size:,} bytes of graph JSON")
    for path, want in targets:
        had = path.read_bytes() if path.exists() else None
        path.write_bytes(want)
        print(f"  {'unchanged' if had == want else 'WROTE    '}  {rel(path)}")


def check():
    size, targets = artifacts()
    stale = [
        rel(path)
        for path, want in targets
        if not path.exists() or path.read_bytes() != want
    ]
    for path, _ in targets:
        print(f"  {'STALE' if rel(path) in stale else 'ok   '}  {rel(path)}")
    if stale:
        raise SystemExit(
            f"\n{len(stale)} evidence-map artifact(s) out of sync with the source "
            f"data.\nRun: python3 {rel(Path(__file__).resolve())}"
        )
    print(f"evidence map in sync ({size:,} bytes of baked graph JSON)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--check",
        action="store_true",
        help="verify the derived copies are in sync; write nothing, exit 1 if stale",
    )
    args = ap.parse_args()

    for path in (FAMILIES_JSON, EVIDENCE_CSV, HTML_FILE):
        if not path.exists():
            raise SystemExit(f"missing input: {path}")
    check() if args.check else write()


if __name__ == "__main__":
    sys.exit(main())
