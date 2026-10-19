// Run after node scripts/bundle-vercel-api.mjs. No network or credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import handler from '../api/gateway.js'
const fixtures=JSON.parse(readFileSync(new URL('../netlify/functions/lib/gate1/golden.json',import.meta.url),'utf8'))
let passed=0
async function call(path,method='GET',body={}) {
  const headers={};let value
  const res={statusCode:200,setHeader:(k,v)=>{headers[k]=v},end:v=>{value=JSON.parse(v)}}
  await handler({url:'/api/gateway',query:{path},method,body},res)
  assert.equal(headers['Cache-Control'],'no-store')
  return {status:res.statusCode,data:value}
}
const check=(name,fn)=>Promise.resolve(fn()).then(()=>{passed++;console.log(`PASS: ${name}`)})
await check('preview config retains the existing version and all threshold values',async()=>{
  const r=await call('config/active');assert.equal(r.status,200);assert.equal(r.data.version,0)
  const cfg=JSON.parse(readFileSync(new URL('../netlify/functions/lib/gate1/default-config.json',import.meta.url),'utf8'))
  assert.deepEqual(r.data.config,cfg)
})
await check('sample still fails for the canonical three hard kills',async()=>{
  const r=await call('gate1/preview','POST',{fields:fixtures.faithful_trails,posture:'green'})
  assert.equal(r.status,200);assert.equal(r.data.result.verdict,'FAIL')
  assert.deepEqual([...r.data.result.kills].sort(),['coinvest_min','contingency_min','site_entitled'])
  assert.deepEqual(Object.keys(r.data.scenarios).sort(),['green','red','yellow'])
})
await check('new incomplete deal never reuses previous RV results',async()=>{
  const r=await call('gate1/preview','POST',{fields:{deal_name:'QA new multifamily',asset_class:'multifamily'},posture:'green'})
  assert.equal(r.status,200);assert.equal(r.data.result.verdict,'REVIEW');assert.ok(r.data.result.missing.length>0)
  assert.ok(!JSON.stringify(r.data).includes('Faithful Trails'))
})
await check('preview batch keeps per-row results',async()=>{
  const r=await call('gate1/preview-batch','POST',{rows:[fixtures.faithful_trails,fixtures.palm_grove],posture:'green'})
  assert.equal(r.data.results[0].result.verdict,'FAIL');assert.equal(r.data.results[1].result.verdict,'PASS')
})
await check('invalid posture is rejected',async()=>assert.equal((await call('gate1/preview','POST',{fields:fixtures.palm_grove,posture:'purple'})).status,400))
await check('judgment override still requires a reason',async()=>assert.equal((await call('gate1/preview','POST',{fields:fixtures.palm_grove,adjustments:[{key:'contingency_min',value:.01,reason:''}]})).status,400))
await check('decision recording is honestly unpersisted',async()=>{
  const r=await call('gate1/decide','POST',{fields:fixtures.palm_grove});assert.equal(r.data.persisted,false);assert.ok(r.data.warning.includes('NOT recorded'))
})
await check('no silent extraction fallback to sample data',async()=>{
  const r=await call('extract','POST',{om:'new deal'});assert.equal(r.status,503);assert.ok(r.data.error.includes('not replaced with sample data'))
})
await check('macro override reason and regime validation survive',async()=>{
  assert.equal((await call('macro/override','POST',{})).status,400)
  assert.equal((await call('macro/override','POST',{note:'QA',regime:'invalid'})).status,400)
})
await check('rulebook saves remain unpersisted and require a note',async()=>{
  assert.equal((await call('config','POST',{})).status,400)
  assert.equal((await call('config','POST',{note:'QA'})).data.persisted,false)
})
console.log(`RESULT: ${passed} passed, 0 failed`)
