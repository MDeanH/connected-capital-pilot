export default async () => {
  return new Response(JSON.stringify({ 
    ok: true, 
    service: "ai-diligence-platform", 
    version: "0.2-netlify",
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  })
}
