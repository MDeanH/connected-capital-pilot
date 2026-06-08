"""
Reusable UI components for the diligence dashboard.
Keeps app.py clean and matches patterns from your other Streamlit dashboards (cards, bars, gauges).
"""

import streamlit as st
import plotly.graph_objects as go


def metric_card(label: str, value: str, sublabel: str = ""):
    st.markdown(
        f"""
        <div class="metric-card">
            <div style="font-size:0.85rem; color:#94a3b8;">{label}</div>
            <div style="font-size:1.65rem; font-weight:700; margin:4px 0;">{value}</div>
            <div style="font-size:0.75rem; color:#64748b;">{sublabel}</div>
        </div>
        """,
        unsafe_allow_html=True
    )


def freshness_banner(state):
    st.caption(f"Public context as of: {state.last_refresh.strftime('%Y-%m-%d %H:%M')}  •  Model: {state.model_config.version}")
    if state.alerts:
        for a in state.alerts[-2:]:
            st.warning(a, icon="⚠️")


def driver_bars(drivers):
    """Simple horizontal contribution bars for explainability."""
    for name, contrib, direction in drivers:
        color = "#22c55e" if direction == "positive" else "#ef4444"
        width = min(100, int(abs(contrib) * 280))
        st.markdown(
            f"""
            <div style="margin:6px 0;">
                <div style="font-size:0.8rem;">{name} <span style="color:{color}">({direction})</span></div>
                <div style="background:#1f2937; border-radius:4px; height:18px; width:100%;">
                    <div style="background:{color}; width:{width}px; height:18px; border-radius:4px;"></div>
                </div>
            </div>
            """,
            unsafe_allow_html=True
        )


def prob_gauge(prob: float, title: str = "Probability"):
    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=prob * 100,
        title={"text": title},
        gauge={
            "axis": {"range": [0, 100]},
            "bar": {"color": "#6366f1"},
            "steps": [
                {"range": [0, 40], "color": "#3f3f46"},
                {"range": [40, 70], "color": "#27272a"},
                {"range": [70, 100], "color": "#18181b"},
            ],
            "threshold": {"line": {"color": "white", "width": 2}, "thickness": 0.75, "value": prob * 100},
        },
        number={"suffix": "%", "font": {"size": 42}},
    ))
    fig.update_layout(height=220, margin=dict(t=20, b=10, l=10, r=10), paper_bgcolor="#0f1116", font_color="#e6e6e6")
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
