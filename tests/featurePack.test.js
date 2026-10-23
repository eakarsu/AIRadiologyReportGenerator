// Offline only: unset provider keys before importing app code, re-unset after
// (auth modules may reload .env). Feature pack never calls a provider.
delete process.env.OPENROUTER_API_KEY; delete process.env.OPENAI_API_KEY;
process.env.JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length>=32 ? process.env.JWT_SECRET : 'test-secret-at-least-32-characters-long!!';
const test=require('node:test'); const assert=require('node:assert/strict');
const express=require('express'); const jwt=require('jsonwebtoken');
const pack=require('../server/routes/featurePack');
delete process.env.OPENROUTER_API_KEY; delete process.env.OPENAI_API_KEY;
const FEATURES=["report-completeness-check","turnaround-summary","worklist-operations-summary"];
async function withServer(fn){ const app=express(); app.use(express.json()); app.use('/api/feature-pack',pack); const s=app.listen(0); await new Promise(r=>s.once('listening',r)); const base=`http://127.0.0.1:${s.address().port}/api/feature-pack`; const token=jwt.sign({id:1}, process.env.JWT_SECRET); try{ await fn(base,token);} finally{ s.close(); } }
test('tasks auth, CRUD, search/filter, export, deterministic AI fallback', async ()=>{
  await withServer(async(base,token)=>{
    const unauth=await fetch(`${base}/tasks`); assert.equal(unauth.status,401);
    const H={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const c=await fetch(`${base}/tasks`,{method:'POST',headers:H,body:JSON.stringify({title:'Alpha task',priority:'high',notes:'',done:false,estimate:0})}); assert.equal(c.status,201); const task=await c.json();
    await fetch(`${base}/tasks`,{method:'POST',headers:H,body:JSON.stringify({title:'Beta task',status:'done'})});
    const list=await (await fetch(`${base}/tasks?search=alpha`,{headers:H})).json(); assert.equal(list.data.length,1); assert.equal(list.data[0].title,'Alpha task');
    const upd=await (await fetch(`${base}/tasks/${task.id}`,{method:'PUT',headers:H,body:JSON.stringify({status:'done',done:true})})).json(); assert.equal(upd.status,'done');
    const csv=await fetch(`${base}/tasks/export?format=csv`,{headers:H}); assert.match(csv.headers.get('content-type'),/text\/csv/); assert.match(await csv.text(),/Alpha task/);
    const js=await (await fetch(`${base}/tasks/export?format=json`,{headers:H})).json(); assert.equal(js.data.length,2);
    for(const f of FEATURES){ const ai=await (await fetch(`${base}/ai/${f}`,{headers:H})).json(); assert.equal(ai.aiGenerated,false); assert.match(ai.label,/Deterministic fallback/); assert.ok(ai.sections.some(s=>s.label==='Total tasks'&&s.value===2)); assert.ok(ai.sections.some(s=>s.label==='Notes'&&s.value==='')); assert.match(ai.disclaimer,/not a diagnosis/); assert.match(ai.disclaimer,/Operational\/reporting support only/); }
  });
});
test('fallback preserves false/0/empty in labelled sections', ()=>{ const out=pack.fallback(FEATURES[0],[{title:'x',status:'open',priority:'low',notes:'',done:false,estimate:0}]); assert.equal(out.aiGenerated,false); const secs=out.tasks[0].sections; assert.equal(secs.find(s=>s.label==='Done').value,false); assert.equal(secs.find(s=>s.label==='Estimate (hours)').value,0); assert.equal(secs.find(s=>s.label==='Notes').value,''); assert.equal(pack.toCsv([{id:1,title:'a,b',status:'open',priority:'low',notes:'',done:false,estimate:0}]).includes('"a,b"'),true); });
