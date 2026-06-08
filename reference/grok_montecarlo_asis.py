import numpy as np
import pandas as pd

def fit_distribution(historical_returns: np.ndarray):
    """Fit mu / sigma from any historical series (NCREIF quarterly returns, Preqin IRRs, RentCast comps, client outcomes)."""
    mu = np.mean(historical_returns)
    sigma = np.std(historical_returns, ddof=0)
    n_obs = len(historical_returns)
    print(f"Fitted from {n_obs} historical observations -> mu = {mu:.4f}, sigma = {sigma:.4f}")
    return mu, sigma

def monte_carlo_irr(
    mu: float,
    sigma: float,
    holding_years: int = 5,
    n_sims: int = 10000,
    target_irr: float = 0.20,
    initial_investment: float = 1_000_000,
    risk_free_rate: float = 0.04,
    correlation_matrix: np.ndarray = None,
    mu_adj: float = 0.0,
    sigma_mult: float = 1.0,
    seed: int = 42
):
    np.random.seed(seed)
    mu_adj = mu + mu_adj
    sigma_adj = sigma * sigma_mult

    if correlation_matrix is None:
        log_mu = np.log(1 + mu_adj) - 0.5 * sigma_adj**2
        annual_logrets = np.random.normal(log_mu, sigma_adj, size=(n_sims, holding_years))
    else:
        n_assets = correlation_matrix.shape[0]
        chol = np.linalg.cholesky(correlation_matrix)
        z = np.random.normal(0, 1, size=(n_sims, n_assets * holding_years))
        annual_logrets = mu_adj - 0.5 * sigma_adj**2 + sigma_adj * (z @ chol.T)[:, :holding_years]

    cum_logret = np.sum(annual_logrets, axis=1)
    total_multiplier = np.exp(cum_logret)
    irrs = total_multiplier ** (1.0 / holding_years) - 1.0

    prob_target = np.mean(irrs >= target_irr)
    expected_irr = np.mean(irrs)
    median_irr = np.median(irrs)
    prob_loss = np.mean(irrs < 0)
    var_95 = np.percentile(irrs, 5)
    cvar_95 = np.mean(irrs[irrs <= var_95])

    edge = expected_irr - risk_free_rate
    kelly = edge / (sigma_adj ** 2) if sigma_adj > 0 else 0.0
    suggested_position_fraction = min(max(kelly * 0.5, 0.01), 0.25)

    results = {
        "P(IRR >= target)": round(prob_target, 4),
        "Expected IRR": round(expected_irr, 4),
        "Median IRR": round(median_irr, 4),
        "P(loss)": round(prob_loss, 4),
        "VaR_5%": round(var_95, 4),
        "CVaR_5%": round(cvar_95, 4),
        "Suggested position % of book": round(suggested_position_fraction * 100, 2),
        "Confidence indicator": f"Based on {n_sims:,} sims + {len(historical_returns) if 'historical_returns' in globals() else 'N/A'} historical obs",
        "Top drivers (example)": ["Sponsor track (DDQ)", "Market vol (NCREIF/Preqin)", "Holding period", "Macro correlation (FRED)"]
    }
    return results, irrs

# ====================== EXAMPLE USAGE ======================
historical_re = np.array([0.08, 0.12, 0.05, 0.15, -0.03, 0.09, 0.11, 0.07, 0.14, 0.06, 0.10, 0.04, 0.13, 0.08, 0.09])
mu, sigma = fit_distribution(historical_re)

single_results, _ = monte_carlo_irr(
    mu=mu, sigma=sigma,
    holding_years=4,
    target_irr=0.20,
    mu_adj=0.03,
    sigma_mult=1.1
)
print("\n=== Single RE Deal Results ===")
for k, v in single_results.items():
    print(f"{k}: {v}")

mu_multi = np.array([0.09, 0.25])
sigma_multi = np.array([0.10, 0.40])
corr_matrix = np.array([[1.00, 0.35],
                        [0.35, 1.00]])

print("\n=== Ready for production scaling ===")
print("-> Load full historical CSVs from NCREIF/Preqin/RentCast -> fit per asset class")
