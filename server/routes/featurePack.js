// Feature pack (wave 43B): authenticated tasks, search/filter, CSV/JSON export,
// domain summaries over the caller's own tasks. Deterministic fallback only —
// this module never imports or calls an AI provider.
const express = require('express');
const AUTH = require('../middleware/auth');
const router = express.Router();
const DISCLAIMER = 'Operational/reporting support only — not a diagnosis. This summary does not interpret images or provide clinical recommendations; a qualified radiologist must review and sign all reports.';
const FEATURES = ["report-completeness-check","turnaround-summary","worklist-operations-summary"];
const store = new Map(); let seq = 0;
function owner(req){ return String(req.user?.id ?? req.user?.user_id ?? req.user?.email ?? 'unknown'); }
function list(ownerKey){ if(!store.has(ownerKey)) store.set(ownerKey, []); return store.get(ownerKey); }
function esc(v){ const s = v===null||v===undefined?'':String(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function toCsv(rows){ const h=['id','title','status','priority','notes','done','estimate','createdAt','updatedAt']; return [h.join(','), ...rows.map(r=>h.map(k=>esc(r[k])).join(','))].join('\n'); }
function filterTasks(rows,q={}){ let out=[...rows]; const s=String(q.search||'').toLowerCase(); if(s) out=out.filter(r=>`${r.title} ${r.notes||''}`.toLowerCase().includes(s)); if(q.status) out=out.filter(r=>r.status===q.status); if(q.priority) out=out.filter(r=>r.priority===q.priority); return out; }
function labelledSections(t){ return [ {label:'Title',value:t.title}, {label:'Status',value:t.status}, {label:'Priority',value:t.priority}, {label:'Notes',value:t.notes ?? ''}, {label:'Done',value:!!t.done}, {label:'Estimate (hours)',value:Number(t.estimate||0)} ]; }
function fallback(feature, tasks){
  const rows = Array.isArray(tasks)?tasks:[];
  const open = rows.filter(r=>r.status!=='done').length;
  const done = rows.filter(r=>r.status==='done' || r.done).length;
  const high = rows.filter(r=>r.priority==='high').length;
  const result = { feature, aiGenerated:false, label:'Deterministic fallback (no AI provider called)', summary:`${rows.length} task(s): ${open} open, ${done} done, ${high} high-priority.`, counts:{ total:rows.length, open, done, highPriority:high }, sections:[ {label:'Total tasks',value:rows.length}, {label:'Open tasks',value:open}, {label:'Done tasks',value:done}, {label:'High-priority tasks',value:high}, {label:'Has open work',value:open>0}, {label:'Notes',value:''} ], tasks: rows.map(r=>({title:r.title, sections:labelledSections(r)})) };
  if (DISCLAIMER) result.disclaimer = DISCLAIMER;
  return result;
}
router.get('/tasks', AUTH, (req,res)=>{ const rows=filterTasks(list(owner(req)), req.query); res.json({data:rows,total:rows.length}); });
router.get('/tasks/export', AUTH, (req,res)=>{ const rows=filterTasks(list(owner(req)), req.query); const fmt=String(req.query.format||'json').toLowerCase(); if(fmt==='csv'){ res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="tasks.csv"'); return res.send(toCsv(rows)); } if(fmt!=='json') return res.status(400).json({error:'format must be json or csv'}); res.setHeader('Content-Disposition','attachment; filename="tasks.json"'); return res.json({data:rows}); });
router.post('/tasks', AUTH, (req,res)=>{ const title=String(req.body?.title||'').trim(); if(!title) return res.status(400).json({error:'title is required'}); const now=new Date().toISOString(); const t={id:++seq, title, status:req.body.status||'open', priority:req.body.priority||'medium', notes:req.body.notes||'', done:!!req.body.done, estimate:Number(req.body.estimate||0), createdAt:now, updatedAt:now}; list(owner(req)).unshift(t); res.status(201).json(t); });
router.put('/tasks/:id', AUTH, update); router.patch('/tasks/:id', AUTH, update);
function update(req,res){ const rows=list(owner(req)); const t=rows.find(r=>r.id===Number(req.params.id)); if(!t) return res.status(404).json({error:'Task not found'}); for(const k of ['title','status','priority','notes','done','estimate']) if(req.body?.[k]!==undefined) t[k]=k==='estimate'?Number(req.body[k]):req.body[k]; t.updatedAt=new Date().toISOString(); res.json(t); }
for(const f of FEATURES){ const handler=(req,res)=>{ const tasks = Array.isArray(req.body?.tasks)?req.body.tasks:list(owner(req)); res.json(fallback(f, tasks)); }; router.post(`/ai/${f}`, AUTH, handler); router.get(`/ai/${f}`, AUTH, handler); }
router.fallback=fallback; router.filterTasks=filterTasks; router.toCsv=toCsv; router.labelledSections=labelledSections; router.store=store; router.FEATURES=FEATURES;
module.exports=router;
