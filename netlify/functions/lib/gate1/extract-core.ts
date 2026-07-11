// Extraction core — shared by the Netlify function and the vite dev bridge so
// local dev exercises the identical call path. Server-side only (SDK + key).
import Anthropic from '@anthropic-ai/sdk'
import {
  buildExtractionSchema,
  buildInstruction,
  coerceExtraction,
  type Discrepancy,
  type ExtractionResult,
  type RawExtractedField,
} from './fields.ts'

export interface ExtractRequest {
  dealName?: string
  pdfBase64?: string
  pdfFilename?: string
  sheets?: Array<{ name: string; csv: string }>
}

export const MODEL = 'claude-opus-4-8'

export async function runExtraction(req: ExtractRequest): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw Object.assign(
      new Error('AI extraction is not configured (ANTHROPIC_API_KEY missing)'),
      { status: 500 },
    )
  }
  if (!req.pdfBase64 && !(req.sheets && req.sheets.length)) {
    throw Object.assign(new Error('Provide an offering memorandum PDF and/or pro forma sheets'), { status: 400 })
  }

  const content: Anthropic.ContentBlockParam[] = []
  if (req.pdfBase64) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: req.pdfBase64 },
    })
  }
  for (const sheet of req.sheets ?? []) {
    content.push({ type: 'text', text: `Pro forma sheet: ${sheet.name}\n${sheet.csv}` })
  }
  content.push({ type: 'text', text: buildInstruction() })

  const client = new Anthropic({ apiKey })
  const started = Date.now()
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: buildExtractionSchema() } },
  } as Anthropic.MessageCreateParamsNonStreaming)

  const text = msg.content.find(b => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('Extraction returned no output')
  const raw = JSON.parse(text.text) as { fields: RawExtractedField[]; discrepancies: Discrepancy[] }
  const parsed = coerceExtraction(raw)
  console.log(
    `extract: model=${MODEL} ms=${Date.now() - started} pdf=${req.pdfBase64 ? Math.round(req.pdfBase64.length / 1024) + 'kb' : 'none'} sheets=${req.sheets?.length ?? 0} discrepancies=${parsed.discrepancies?.length ?? 0}`,
  )
  return { ...parsed, model: MODEL }
}
