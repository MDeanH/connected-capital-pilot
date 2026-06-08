#!/bin/zsh
# Quick launcher for the AI Diligence Platform
cd "$(dirname "$0")"

echo "🚀 Starting AI Diligence Tool..."

# Create venv if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate
source .venv/bin/activate

# Install dependencies if needed
if ! python -c "import pandas, streamlit, plotly" 2>/dev/null; then
    echo "Installing dependencies (this may take a minute the first time)..."
    pip install -r requirements.txt
fi

echo ""
echo "✅ Ready! The dashboard will open in your browser."
echo "   If it doesn't open automatically, go to: http://localhost:8501"
echo ""
echo "Press Ctrl+C in this terminal to stop the app."
echo ""

# Run Streamlit
streamlit run app.py --server.headless true
