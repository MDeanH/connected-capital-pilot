// Grok / xAI proxy for the Diligence Copilot
// IMPORTANT: Set XAI_API_KEY in Netlify site settings → Environment variables
//
// Netlify v2 function: native per-IP rate limiting is declared in `config`
// below and enforced by the platform BEFORE this code runs, so abusive callers
// never reach the paid xAI call. Routed via config.path (no netlify.toml redirect).

import type { Config, Context } from '@netlify/functions'

const XAI_API = 'https://api.x.ai/v1/chat/completions'
const MAX_BODY_BYTES = 24_000

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Size cap before parsing: public endpoint proxying a paid LLM — reject
  // oversized payloads up front to limit token-cost abuse.
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Request too large' })

  let body: any
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const { messages, context } = body

  // Validate shape and bound the conversation the caller can drive.
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return json(400, { error: 'Invalid messages' })
  }
  const cappedMessages = messages.slice(-20).map((m: any) => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: String(m?.content ?? '').slice(0, 4000),
  }))
  const cappedContext = String(context ?? '').slice(0, 12_000)

  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    console.error('XAI_API_KEY not configured')
    return json(500, { error: 'AI service is not configured' })
  }

  const systemPrompt = `You are an expert alternative investments due diligence analyst.
You are helping with the AI Diligence Platform for real estate development and value-add deals (and eventually other alts).

Use the provided context (current filtered opportunities, model weights, scores, past deals) to give grounded, concise answers.
Never hallucinate numbers. When you don't have data, say so.
Be transparent about limitations.`

  const requestBody = {
    model: 'grok-3-mini', // or 'grok-3' depending on your access
    messages: [
      {
        role: 'system',
        content: systemPrompt + '\n\nCurrent context:\n' + (cappedContext || 'No additional context provided.'),
      },
      ...cappedMessages,
    ],
    temperature: 0.4,
    max_tokens: 800,
  }

  try {
    const res = await fetch(XAI_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('xAI API error', res.status, errText)
      return json(502, { error: 'AI service temporarily unavailable' })
    }

    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || 'No response from model.'
    return json(200, { reply })
  } catch (err: any) {
    console.error('grok-chat internal error', err?.message)
    return json(500, { error: 'AI service temporarily unavailable' })
  }
}

export const config: Config = {
  path: '/api/grok/chat',
  rateLimit: {
    windowSize: 60,      // seconds
    windowLimit: 20,     // max requests per window per aggregation key
    aggregateBy: ['ip', 'domain'],
  },
}
