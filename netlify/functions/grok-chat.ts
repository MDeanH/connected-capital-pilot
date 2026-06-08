// Simple Grok / xAI proxy for the Diligence Copilot
// Set XAI_API_KEY in Netlify site settings (Environment variables)

const XAI_API = "https://api.x.ai/v1/chat/completions"

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const { messages, context } = await req.json()

  const apiKey = Deno.env.get("XAI_API_KEY") || process.env.XAI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ 
      error: "XAI_API_KEY not configured in Netlify environment variables" 
    }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    })
  }

  const systemPrompt = `You are an expert alternative investments due diligence analyst. 
You are helping with the AI Diligence Platform for real estate development and value-add deals (and eventually other alts).

Use the provided context (current filtered opportunities, model weights, scores, past deals) to give grounded, concise answers.
Never hallucinate numbers. When you don't have data, say so.
Be transparent about limitations.`

  const body = {
    model: "grok-3-mini",   // or grok-3 as available
    messages: [
      { role: "system", content: systemPrompt + "\n\nCurrent context:\n" + (context || "No additional context provided.") },
      ...messages
    ],
    temperature: 0.4,
    max_tokens: 800,
  }

  const res = await fetch(XAI_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    return new Response(JSON.stringify({ error: "Grok API error", details: err }), { 
      status: 502, 
      headers: { "Content-Type": "application/json" } 
    })
  }

  const data = await res.json()
  const reply = data.choices?.[0]?.message?.content || "No response from model."

  return new Response(JSON.stringify({ reply }), {
    headers: { "Content-Type": "application/json" }
  })
}
