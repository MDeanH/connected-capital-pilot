// Diligence scoring endpoint — runs the VERIFIED Monte Carlo engine (TS port) server-side.
// POST /api/score  -> full deal score (honest-risk model) + the naive index-only contrast.
// v2 function: reachable at its default /.netlify/functions/score endpoint, which the
// /api/score redirect in netlify.toml targets. rateLimit mirrors the sibling functions
// (deals.ts / gate1.ts) so this heavy Monte Carlo endpoint is throttled per client IP.
import type { Config } from '@netlify/functions';
import { computeScore } from './lib/compute.ts';

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  if (raw.length > 32_000) return json(413, { error: 'Request too large' });
  let body: any;
  try { body = JSON.parse(raw || '{}'); }
  catch { return json(400, { error: 'Invalid JSON body' }); }
  try {
    const result = computeScore(body);
    return json(200, result);
  } catch (e: any) {
    // Generic message to the client; the raw cause stays server-side only.
    console.error('score error', e?.message);
    return json(500, { error: 'Scoring failed' });
  }
};

export const config: Config = {
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: 'ip' },
};
