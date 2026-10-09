// mammoth (the .docx text extractor) is loaded on demand (dynamic import) so
// it stays out of the entry bundle — same pattern as excel.ts lazy-loading
// xlsx. A fetch failure here is a network/deploy problem, not a bad document —
// say so instead of letting "Failed to fetch module" blame the user's file.
async function loadMammoth() {
  try {
    return await import('mammoth')
  } catch {
    throw new Error('the document-conversion library could not be downloaded — check your connection and try again (reloading the page may help).')
  }
}

/** Cap on OM text sent to extraction, so a huge document can't blow past the body limit. */
export const MAX_OM_TEXT_CHARS = 200_000

/**
 * Deal-document ingest: convert an uploaded .docx or .txt offering memorandum
 * to plain text for the AI extraction endpoint. Conversion happens entirely in
 * the browser — only the text leaves the machine. Page numbers do not survive
 * the conversion, so citations degrade to quote-only (like pro forma CSVs).
 */
export async function docToText(file: File): Promise<string> {
  let text: string
  if (/\.docx$/i.test(file.name)) {
    const mammoth = await loadMammoth()
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    text = value
  } else {
    text = await file.text()
  }
  text = text.trim()
  if (!text) throw new Error(`No text found in "${file.name}"`)
  if (text.length > MAX_OM_TEXT_CHARS) {
    text = text.slice(0, MAX_OM_TEXT_CHARS) + '\n…[truncated — document text exceeds the 200,000-character cap]'
  }
  return text
}
