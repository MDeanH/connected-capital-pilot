// Diligence scoring endpoint — runs the VERIFIED Monte Carlo engine (TS port) server-side.
// POST /api/score  -> full deal score (honest-risk model) + the naive index-only contrast.
import type { Handler } from '@netlify/functions';
import { computeScore } from './lib/compute.ts';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if ((event.body || '').length > 32_000) return { statusCode: 413, body: JSON.stringify({ error: 'Request too large' }) };
  let body: any;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  try {
    const result = computeScore(body);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  } catch (e: any) {
    console.error('score error', e?.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Scoring failed' }) };
  }
};
