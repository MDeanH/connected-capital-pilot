// Grok / xAI proxy for the Diligence Copilot
// IMPORTANT: Set XAI_API_KEY in Netlify site settings → Environment variables

import { Handler } from '@netlify/functions'

const XAI_API = 'https://api.x.ai/v1/chat/completions'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method not allowed',
    }
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    }
  }

  const { messages, context } = body

  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: "XAI_API_KEY not configured. Go to Netlify site settings → Environment variables and add it." 
      }),
    }
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
        content: systemPrompt + '\n\nCurrent context:\n' + (context || 'No additional context provided.') 
      },
      ...messages
    ],
    temperature: 0.4,
    max_tokens: 800,
  }

  try {
    const res = await fetch(XAI_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!res.ok) {
      const errText = await res.text()
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Grok API error', details: errText }),
      }
    }

    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || 'No response from model.'

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal error calling Grok', details: err.message }),
    }
  }
}
