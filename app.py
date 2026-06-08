"""
AI Investment Due-Diligence & Probability Platform
Streamlit-first MVP (RE Dev + Value-Add focus)

Run: streamlit run app.py
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime

# Local imports (will grow)
from src.state import DiligenceState, get_state
from src.model.scoring import compute_probability_result, simple_monte_carlo
from src.data.sample import get_sample_past_deals, get_sample_opportunities
from src.ui.components import metric_card, freshness_banner, driver_bars, prob_gauge

st.set_page_config(
    page_title="AI Diligence | Probability Platform",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom dark finance theme (inspired by your existing dashboards)
st.markdown("""
<style>
    .stApp { background-color: #0f1116; color: #e6e6e6; }
    .metric-card { background: #1a1f2e; border-radius: 12px; padding: 16px; border: 1px solid #2a3142; }
    .driver-bar { height: 22px; background: linear-gradient(90deg, #22c55e, #eab308, #ef4444); border-radius: 4px; }
    .section-header { font-size: 1.1rem; font-weight: 600; margin-bottom: 8px; color: #a5b4fc; }
    .disclaimer { font-size: 0.8rem; color: #64748b; }
    .prob-high { color: #22c55e; font-weight: 600; }
    .prob-med { color: #eab308; font-weight: 600; }
    .prob-low { color: #ef4444; font-weight: 600; }
</style>
""", unsafe_allow_html=True)

# Initialize state (uses Streamlit session_state + our wrapper)
state: DiligenceState = get_state()

# Sidebar — Analyst Controls (core to the vision)
with st.sidebar:
    st.title("⚙️ Analyst Studio")
    st.caption("Update the model live. Changes affect all scores immediately.")

    # Model config controls (transparent & editable)
    st.subheader("Model Parameters")
    target_return = st.slider("Target Net Return (e.g. 20%)", 0.10, 0.35, state.model_config.target_return_default, 0.01, format="%.0f%%")
    state.model_config.target_return_default = target_return

    mc = state.model_config.mc_params or {}
    st.caption(f"Engine: de-smoothed NCREIF-style MC • {mc.get('n_sims', 10000):,} paths • {mc.get('holding_years', 4)} yr hold • autocorr={mc.get('autocorrelation', 0.70)} (true vol = reported / sqrt(1-rho))")

    st.divider()
    st.subheader("Quick Feature Weights (RE Dev/Value-Add)")
    # Simple editable weights for transparency (real version will be richer)
    w_sponsor = st.slider("Sponsor Track Record", 0.0, 1.0, 0.28, 0.01)
    w_market = st.slider("Market / Supply-Demand", 0.0, 1.0, 0.22, 0.01)
    w_structure = st.slider("Deal Structure / Terms", 0.0, 1.0, 0.18, 0.01)
    w_macro = st.slider("Macro (Rates + Indicators)", 0.0, 1.0, 0.20, 0.01)
    w_qual = st.slider("Qualitative / Execution Risk (DDQ)", 0.0, 1.0, 0.12, 0.01)

    if st.button("Apply Weights & Recompute", type="primary", use_container_width=True):
        state.model_config.feature_weights = {
            "sponsor": w_sponsor,
            "market": w_market,
            "structure": w_structure,
            "macro": w_macro,
            "qual": w_qual,
        }
        state.recompute_all()
        st.success("Model updated. Scores refreshed.")

    st.caption("💡 These are starting points. Add custom rules in the Model tab.")

    st.divider()
    st.subheader("Data Freshness")
    freshness_banner(state)

    if st.button("Reload Public Context (FRED/Zillow sample)", use_container_width=True):
        state.refresh_public_context()
        st.rerun()

# Main header
st.title("AI Diligence Platform")
st.caption("De-biased Monte Carlo (client history + DDQ) • P(IRR ≥ target) • VaR/CVaR • Kelly position size • Analyst live weights")

# Top disclaimer (per scoping doc)
st.markdown(
    '<div class="disclaimer">This is a modeling and analysis tool for internal discussion. Outputs are conditional on inputs and historical patterns. Not investment advice. Past performance and model scores do not guarantee future results.</div>',
    unsafe_allow_html=True
)

# Tabs (matches plan)
tab_dashboard, tab_opps, tab_ddq, tab_model, tab_corr, tab_copilot = st.tabs([
    "📊 Client Dashboard",
    "Opportunities",
    "DDQ Intake",
    "Analyst Model Studio",
    "Correlations",
    "🧠 Diligence Copilot"
])

# ========== TAB 1: Client Dashboard (main client-facing view) ==========
with tab_dashboard:
    st.header("Portfolio / Opportunity View")
    st.caption("Current view of scored opportunities. Filter and drill into details. AI Copilot can control these filters.")

    # Quick metrics row (inspired by crime-map stats + Edge metrics)
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        metric_card("Avg. Hit Probability", f"{state.get_avg_prob():.0%}", "Across filtered opportunities")
    with col2:
        metric_card("High-Confidence Deals", str(state.get_high_conf_count()), "Confidence ≥ 0.65")
    with col3:
        metric_card("Target Return", f"{state.model_config.target_return_default:.0%}", "Current model target")
    with col4:
        metric_card("Last Analyst Update", state.model_config.last_updated.strftime("%Y-%m-%d"), "Model version " + state.model_config.version)

    # Filters (simple, extensible like crime type chips)
    st.subheader("Filters")
    fcol1, fcol2 = st.columns([2, 3])
    with fcol1:
        prob_min = st.slider("Min Probability", 0.0, 1.0, 0.0, 0.05)
    with fcol2:
        subtypes = st.multiselect("Sub-type", ["Development", "Value-Add"], default=["Development", "Value-Add"])

    filtered = state.get_filtered_opportunities(min_prob=prob_min, subtypes=subtypes)

    # Main table (pandas dataframe — your dashboards love this)
    if not filtered.empty:
        st.dataframe(
            filtered[["name", "sub_type", "p_hit_target", "expected_return", "downside_p_loss", "confidence", "top_driver", "recommended_size_pct"]],
            width="stretch",
            hide_index=True,
            column_config={
                "p_hit_target": st.column_config.ProgressColumn("P(Hit Target)", min_value=0, max_value=1, format="%.0f%%"),
                "expected_return": st.column_config.NumberColumn("Expected Return", format="%.1f%%"),
                "downside_p_loss": st.column_config.NumberColumn("P(Loss)", format="%.0f%%"),
                "confidence": st.column_config.ProgressColumn("Confidence", min_value=0, max_value=1, format="%.0f%%"),
                "recommended_size_pct": st.column_config.NumberColumn("Suggested % of Book", format="%.1f%%"),
            }
        )
    else:
        st.info("No opportunities match current filters.")

    # Selected detail (click simulation via selectbox for MVP)
    st.subheader("Opportunity Detail")
    if not filtered.empty:
        selected_name = st.selectbox("Select opportunity", filtered["name"].tolist())
        sel = filtered[filtered["name"] == selected_name].iloc[0]

        st.markdown(f"### {sel['name']} — {sel['sub_type']}")
        st.caption(f"Target: {state.model_config.target_return_default:.0%} | Model v{state.model_config.version}")

        # Gauges + risk note
        c1, c2 = st.columns([1, 2])
        with c1:
            prob_gauge(sel["p_hit_target"], "Probability of Hitting Target")
        with c2:
            st.markdown("**Risk to earn the target return**")
            st.write(sel.get("risk_note", "Run full MC for detailed downside scenarios."))
            st.markdown(f"**Recommended allocation**: ~{sel['recommended_size_pct']:.1f}% of book (risk-budgeted)")

        # Drivers (explainability — critical for transparency)
        st.markdown("#### Top Drivers (why this score?)")
        driver_bars(sel.get("drivers", []))

        # Real de-biased MC distribution (wired to the grounded PoC)
        st.markdown("#### Return Distribution (De-biased Monte Carlo)")
        score_dict = state.scores.get(sel.get("id"), {}) if "id" in sel.index else {}
        irrs = score_dict.get("_irrs")
        if irrs is None:
            # Fallback: re-run the exact engine for this row (10k sims is fast)
            from src.model.scoring import compute_probability_result
            full_res = compute_probability_result(sel.to_dict(), state.model_config, state.past_deals)
            irrs = full_res.get("_irrs", np.random.normal(sel["expected_return"], score_dict.get("de_smoothed_sigma", 0.09), 5000))

        fig = px.histogram(
            x=irrs,
            nbins=80,
            labels={"x": "Simulated IRR (annualized, de-smoothed)"},
            title="De-biased Monte Carlo — client history + DDQ/weight adj (10k paths)"
        )
        target = state.model_config.target_return_default
        fig.add_vline(x=target, line_dash="dash", line_color="#eab308", annotation_text=f"Target {target:.0%}")
        # also mark median and VaR for transparency
        if "median_irr" in score_dict:
            fig.add_vline(x=score_dict["median_irr"], line_dash="dot", line_color="#22c55e", annotation_text="Median")
        if "var_5pct" in score_dict:
            fig.add_vline(x=score_dict["var_5pct"], line_dash="dot", line_color="#ef4444", annotation_text="VaR 5%")
        st.plotly_chart(fig, width="stretch")

        # Extra grounded MC metrics (the ones the scoping + grounded PoC emphasize)
        mcol1, mcol2, mcol3, mcol4 = st.columns(4)
        with mcol1:
            st.metric("Median IRR", f"{score_dict.get('median_irr', sel.get('expected_return',0)):.1%}")
        with mcol2:
            st.metric("VaR (5%)", f"{score_dict.get('var_5pct', -0.05):.1%}")
        with mcol3:
            st.metric("CVaR (5%)", f"{score_dict.get('cvar_5pct', -0.08):.1%}")
        with mcol4:
            st.metric("De-smoothed σ (true vol)", f"{score_dict.get('de_smoothed_sigma', 0.09):.1%}")

    else:
        st.warning("Load or create opportunities in the Opportunities tab or upload data.")

# ========== TAB 2: Opportunities (list + quick add) ==========
with tab_opps:
    st.header("Opportunities & Past Deals")
    st.write("Current book + historical outcomes used for calibration and confidence.")

    st.subheader("Current Opportunities")
    opps = state.get_all_opportunities()
    st.dataframe(opps, width="stretch", hide_index=True)

    st.subheader("Historical / Past Deals (training signal)")
    past = state.get_past_deals()
    st.dataframe(past, width="stretch", hide_index=True)

    with st.expander("Upload your own data (CSV)"):
        uploaded = st.file_uploader("Past deals or opportunities CSV", type=["csv"])
        if uploaded:
            df = pd.read_csv(uploaded)
            state.ingest_user_csv(df)
            st.success("Data ingested. Recompute to update scores.")
            st.rerun()

# ========== TAB 3: DDQ Intake (structured + upload) ==========
with tab_ddq:
    st.header("DDQ — Due Diligence Questionnaire (RE Dev / Value-Add)")
    st.caption("Structured intake for qualitative facts. Upload PDFs for extraction (stub in MVP).")

    with st.form("ddq_form"):
        st.subheader("Sponsor & Track Record")
        sponsor_exits = st.number_input("Comparable exits by sponsor (last 10 yrs)", 0, 20, 3)
        sponsor_domain = st.selectbox("Domain experience strength", ["Weak", "Moderate", "Strong"])

        st.subheader("Project / Deal Economics")
        projected_irr = st.slider("Projected gross IRR (base case)", 0.08, 0.40, 0.22, 0.01)
        ltv = st.slider("Peak LTV / leverage", 0.40, 0.85, 0.65, 0.05)

        st.subheader("Risks & Qualitative")
        execution_risk = st.select_slider("Execution / entitlement risk", ["Low", "Medium", "High"])
        notes = st.text_area("Key qualitative notes / red flags (free text — will be quantized)")

        submitted = st.form_submit_button("Save DDQ & Score Opportunity")
        if submitted:
            from src.ddq.extract import extract_ddq_from_text, quantize_qualitative
            extracted = extract_ddq_from_text(notes or "Sponsor has moderate track record. Some execution concerns noted.", "Development")
            q = quantize_qualitative(extracted)
            # For demo: create a quick opportunity row and force a recompute with the new qual data
            new_opp = {
                "id": f"ddq_{datetime.now().strftime('%H%M%S')}",
                "name": "New DDQ Opportunity (from form)",
                "sub_type": "Development",
                "sponsor_exits": sponsor_exits,
                "ltv": ltv,
                "execution_risk": execution_risk,
                "rate_environment": "elevated",
            }
            state.opportunities = pd.concat([state.opportunities, pd.DataFrame([new_opp])], ignore_index=True)
            state.recompute_all()
            st.success(f"DDQ captured + quantized. New opportunity added with qual adjustment ~{q['qual_risk_adjustment']:.2f}. Scores refreshed.")
            st.rerun()

    st.divider()
    st.caption("MVP extraction stub (see src/ddq/extract.py). Future: PDF upload → pdfplumber + LLM (local preferred) → structured fields + confidence + risk flags. Templates based on INREV/ILPA/PRI + custom for Dev/Value-Add.")

# ========== TAB 4: Analyst Model Studio ==========
with tab_model:
    st.header("Analyst Model Studio")
    st.write("The heart of the 'analyst updates the model' requirement. Transparent and auditable.")

    st.subheader("Current Model Config")
    st.json(state.model_config.model_dump() if hasattr(state.model_config, 'model_dump') else state.model_config.__dict__)

    st.subheader("Custom Rules (example)")
    st.code("""
if sponsor_exits < 2:
    cap p_hit_target at 0.65
if execution_risk == "High" and ltv > 0.70:
    subtract 0.12 from base probability
""", language="python")

    st.info("Full rule editor + versioning + historical backtest coming in next iteration. Use sidebar weights for immediate impact.")

# ========== TAB 5: Correlations ==========
with tab_corr:
    st.header("Cross-Market Correlations & Portfolio View")
    st.write("Explicit correlations (rates, macro, sectors) feed the probability engine and portfolio risk.")

    corr_df = pd.DataFrame({
        "RE_Dev": [1.0, 0.65, 0.35],
        "RE_ValueAdd": [0.65, 1.0, 0.40],
        "Private_Lending": [0.35, 0.40, 1.0],
    }, index=["RE_Dev", "RE_ValueAdd", "Private_Lending"])

    # Use Plotly heatmap instead of pandas styler (avoids needing matplotlib)
    import plotly.express as px
    fig = px.imshow(
        corr_df,
        text_auto=True,
        color_continuous_scale="RdYlGn",
        zmin=-1,
        zmax=1,
        labels=dict(color="Correlation")
    )
    fig.update_layout(title="Cross-Asset Class Correlation Matrix (illustrative)")
    st.plotly_chart(fig, use_container_width=True)
    st.caption("Editable matrix + full MC portfolio simulation in later iterations. Your own book correlations are the edge.")

# ========== TAB 6: Diligence Copilot ==========
with tab_copilot:
    st.header("🧠 Diligence Copilot (AI Analyst)")
    st.caption("Ask questions about current view, specific deals, or scenarios. Grounded in the data + model state.")

    # Simple chat placeholder (will be upgraded to real agent + tools)
    if "chat_history" not in st.session_state:
        st.session_state.chat_history = []

    for msg in st.session_state.chat_history:
        with st.chat_message(msg["role"]):
            st.write(msg["content"])

    prompt = st.chat_input("What is driving the low probability on the downtown value-add deal? Run a +150bps rate scenario.")
    if prompt:
        st.session_state.chat_history.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.write(prompt)

        # Placeholder grounded response (real version uses tools + rich context)
        response = "Based on current model weights and the selected opportunity: high execution risk + elevated LTV are the largest negative drivers. A +150bps rate shock would reduce P(hit) by approximately 11-14 percentage points in the illustrative MC (replace with real engine)."
        st.session_state.chat_history.append({"role": "assistant", "content": response})
        with st.chat_message("assistant"):
            st.write(response)

    st.caption("Next: Real tool-calling (filter view, explain specific deal, update a weight, run scenario) + rich context injection like your crime-map copilot.")

# Footer
st.divider()
st.caption("All computation local by default. Public data (FRED, Zillow Research, Census) used for context only. Your historical outcomes + DDQ inputs provide the proprietary edge. Revisit the plan.md for full roadmap and data feasibility notes.")