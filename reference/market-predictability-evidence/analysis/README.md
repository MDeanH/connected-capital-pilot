# Evidence-map analysis lineage (provenance warning)

These files come from the `claude/great-tharp-dff2dc` research line (tip
ccb7278, 2026-07-14): a verdict-prediction formula (`verdict_model.py`),
a diligence prior (`diligence_prior.py`), real-market-data validation
(`real-data-findings.md`), the formula analysis, and the external-evidence
layer (`external-connections.json`: 10 out-of-ledger anchors + 5 family
flags).

**Status: computed against the PRE-CORRECTION evidence snapshot**
(upstream 125dce2, verified blob-identical 2026-07-17) — i.e. before the
54-agent-review corrections (upstream 985a7dd "v1.1") that the data files
one directory up now carry. The 10 external anchors are data-independent
and reusable; the 5 `family_flags` and any verdict-formula conclusions
must be REVALIDATED against the v1.1 families JSON before being cited or
wired into the shipped visualization. An enhanced viz shell (external
layer + mobile-friendly) exists in git history at ccb7278 for a future
rebake once revalidated.
