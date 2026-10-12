import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import NativeAIControls from './components/NativeAIControls';
import NativeAIReport from './components/NativeAIReport';
import useNativeAIRequest from './components/useNativeAIRequest';
import { presetExample } from './nativePresetExamples';
import './NativeWorkflowStudio.css';

const label = key => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
const list = value => Array.isArray(value) ? value : value?.data || value?.rows || value?.items || [];
function RecordValue({ value }) {
  if (typeof value === 'string' && /^(?:\[|\{)/.test(value.trim())) { try { return <RecordValue value={JSON.parse(value)} />; } catch {} }
  if (value == null) return <span>Not supplied</span>;
  if (Array.isArray(value)) return <ul>{value.map((item,index) => <li key={index}><RecordValue value={item} /></li>)}</ul>;
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key,item]) => <React.Fragment key={key}><dt>{label(key)}</dt><dd><RecordValue value={item} /></dd></React.Fragment>)}</dl>;
  return <span>{String(value)}</span>;
}

function RecordDialog({ selected, close, request, reload }) {
  const { resource, row } = selected;
  const [editing, setEditing] = useState(false), [form, setForm] = useState(row), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const box = useRef(null);
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; box.current?.focus();
    const key = event => { if(event.key === 'Escape' && !busy)close(); if(event.key==='Tab'){const nodes=[...box.current.querySelectorAll('button,input,textarea,select,[tabindex]')].filter(node=>!node.disabled&&node.tabIndex>=0);const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}} };
    document.addEventListener('keydown',key);
    return () => { document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus(); };
  },[close,busy]);
  async function save() {
    setBusy(true);setError('');
    try {const payload=Object.fromEntries((resource.updateFields||resource.fields).map(key=>[key,typeof row[key]==='object'&&typeof form[key]==='string'?JSON.parse(form[key]):form[key]]));await request(resource.endpoint+'/'+encodeURIComponent(row.id),{method:'PUT',body:JSON.stringify(payload)});await reload();close();}
    catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  async function remove() {
    if(!window.confirm('Delete this saved record?'))return;
    setBusy(true);setError('');
    try {await request(resource.endpoint+'/'+encodeURIComponent(row.id),{method:'DELETE'});await reload();close();}
    catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  return <div className="native-workflow-backdrop" onClick={event=>{if(event.target===event.currentTarget&&!busy)close();}}><section className="native-workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="native-workflow-record-heading" ref={box} tabIndex={-1}><header><h2 id="native-workflow-record-heading">{row.name||row.title||row.productName||resource.label} · {row.id}</h2><button type="button" disabled={busy} onClick={close}>Cancel</button></header><div className="native-workflow-dialog-body">{error&&<p role="alert">{error}</p>}{editing?<div className="native-workflow-fields">{resource.fields.map(key=><label key={key}>{label(key)}{typeof form[key]==='boolean'?<input type="checkbox" checked={form[key]} onChange={event=>setForm({...form,[key]:event.target.checked})}/>:<textarea value={form[key]&&typeof form[key]==='object'?JSON.stringify(form[key],null,2):form[key]??''} onChange={event=>setForm({...form,[key]:typeof row[key]==='number'?Number(event.target.value):event.target.value})}/>}</label>)}</div>:<RecordValue value={row}/>}</div><footer>{resource.fields?.length>0&&(editing?<button type="button" disabled={busy} onClick={save}>{busy?'Saving…':'Save changes'}</button>:<button type="button" onClick={()=>setEditing(true)}>Edit</button>)}{resource.delete&&<button type="button" className="native-workflow-danger" disabled={busy} onClick={remove}>Delete</button>}<button type="button" disabled={busy} onClick={close}>Cancel</button></footer></section></div>;
}

export default function NativeWorkflowStudio({ config, request }) {
  const [search,setSearch] = useState('');
  const [active,setActive] = useState(config.features[0]?.id||''), [form,setForm] = useState({}), [result,setResult] = useState(null), [error,setError] = useState(''), [records,setRecords] = useState({}), [recordError,setRecordError] = useState(''), [selected,setSelected] = useState(null);
  const [history,setHistory] = useState([]), [savedResult,setSavedResult] = useState(null), [historyError,setHistoryError] = useState('');
  const native = useNativeAIRequest(); const feature = config.features.find(item=>item.id===active);
  const cancel = native.cancel;
  useLayoutEffect(()=>{cancel();setForm({});setResult(null);setError('');},[active,cancel]);
  async function loadRecords() {
    const rows={};const problems=[];
    await Promise.all(config.resources.map(async resource=>{try{rows[resource.key]=list(await request(resource.endpoint));}catch(failure){rows[resource.key]=[];problems.push(resource.label+': '+failure.message);}}));
    setRecords(rows);setRecordError(problems.join('\n'));
  }
  async function loadHistory() {
    try { setHistory(list(await request('/api/ai/history?limit=20'))); setHistoryError(''); }
    catch (failure) { setHistoryError(failure.message); }
  }
  async function openSaved(id) {
    try { setSavedResult(await request('/api/ai/history/'+encodeURIComponent(id))); setHistoryError(''); }
    catch (failure) { setHistoryError(failure.message); }
  }
  useEffect(()=>{loadHistory();},[request]);
  useEffect(()=>{let active=true;const rows={};const problems=[];Promise.all(config.resources.map(async resource=>{try{rows[resource.key]=list(await request(resource.endpoint));}catch(failure){rows[resource.key]=[];problems.push(resource.label+': '+failure.message);}})).then(()=>{if(active){setRecords(rows);setRecordError(problems.join('\n'));}});return()=>{active=false;};},[config,request]);
  const missingRequired = (feature?.fields || []).filter(field => {
    const value = form[field.key];
    if (field.type === 'file') return field.required && !(value instanceof File);
    if (value == null || String(value).trim() === '') return field.required;
    return field.resource && !(records[field.resource] || []).some(row => String(row.id) === String(value));
  });
  async function generate(event) {
    event.preventDefault();
    if (native.busy) return;
    if (missingRequired.length) { setError('Supply actual ' + missingRequired.map(field => field.label).join(', ') + ' before generating.'); return; }
    setError('');setResult(null);
    try {
      const body={};
      for(const field of feature.fields){const value=form[field.key];if(value==null||value==='')continue;body[field.key]=field.type==='json'?JSON.parse(value):field.type==='number'?Number(value):value;}
      let payload = JSON.stringify(body);
      if (feature.fields.some(field => field.type === 'file')) {
        payload = new FormData();
        for (const [key, value] of Object.entries(body)) payload.append(key, value instanceof File ? value : typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
      const answer=await native.run(signal=>request(feature.endpoint,{method:'POST',body:payload,signal}));
      setResult(answer);
      loadHistory();
    }catch(failure){setError(failure.name==='AbortError'?'Request canceled.':failure.message);}
  }
  const presets=[0,1,2].map(index=>({name:['Quick brief','Team planning','Detailed review'][index],fill:()=>{const values={};const manual=[];feature.fields.forEach(field=>{if(field.type==='file'){values[field.key]=form[field.key];if(!(form[field.key] instanceof File))manual.push(field.label);}else if(field.resource){const options=records[field.resource]||[];const existing=String(form[field.key]||'');values[field.key]=options.some(row=>String(row.id)===existing)?existing:String(options[Math.min(index,options.length-1)]?.id||'');if(!values[field.key])manual.push(field.label);}else if(field.manual){values[field.key]=form[field.key]||'';if(!values[field.key])manual.push(field.label);}else values[field.key]=presetExample(field,index);});setForm(values);return{filled:feature.fields.length-manual.length,manual};}}));
  return <section className="native-workflow-studio" id="native-ai-studio"><header><p className="eyebrow">AI workspace</p><h2>{config.title}</h2><p>Choose a native tool, review a complete example, then generate one response. Source records and required uploads use your actual data.</p></header><div className="native-workflow-layout"><nav aria-label="AI tools"><label>Find a tool<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search AI tools"/></label>{config.features.filter(item=>item.title.toLowerCase().includes(search.toLowerCase())).map(item=><button key={item.id} type="button" aria-current={active===item.id?'page':undefined} onClick={()=>setActive(item.id)}>{item.title}</button>)}</nav><main>{feature&&<NativeAIControls busy={native.busy} onCancel={native.cancel} presets={presets} context={config.title}><form onSubmit={generate}><h3>{feature.title}</h3><p>{feature.description}</p><div className="native-workflow-fields">{feature.fields.map(field=><label key={field.key} htmlFor={'native-workflow-'+field.key}>{field.label}{field.required?' *':' (optional)'}{field.resource?<select id={'native-workflow-'+field.key} value={form[field.key]||''} required={field.required} onChange={event=>setForm({...form,[field.key]:event.target.value})}><option value="">Choose a stored record</option>{(records[field.resource]||[]).map(row=><option key={row.id} value={row.id}>{row.name||row.title||row.productName||row.first_name||row.id} · {row.id}</option>)}</select>:field.type==='file'?<input key={active+'-'+field.key} id={'native-workflow-'+field.key} type="file" accept={field.accept} required={field.required&&!form[field.key]} onChange={event=>setForm({...form,[field.key]:event.target.files?.[0]})}/>:field.type==='number'?<input id={'native-workflow-'+field.key} type="number" step="any" value={form[field.key]??''} required={field.required} onChange={event=>setForm({...form,[field.key]:event.target.value})}/>:<textarea id={'native-workflow-'+field.key} value={form[field.key]??''} required={field.required} rows={field.type==='json'?6:3} placeholder={field.manual?'Supply the actual source or reference before running.':field.type==='json'?'Paste the native JSON input schema.':''} onChange={event=>setForm({...form,[field.key]:event.target.value})}/>}</label>)}</div><button type="submit" className="native-workflow-generate" disabled={native.busy||missingRequired.length>0}>{native.busy?'Generating…':'Generate with OpenRouter'}</button>{missingRequired.length>0&&<p role="status">Supply actual {missingRequired.map(field=>field.label).join(', ')} before generating.</p>}{error&&<p role="alert">{error}</p>}</form></NativeAIControls>}{result&&<NativeAIReport response={result} title={feature?.title||'AI report'}/>}</main></div><section className="native-workflow-records"><h3>Stored records</h3><button type="button" onClick={loadRecords}>Refresh records</button>{recordError&&<p role="status">{recordError}</p>}{config.resources.map(resource=><article key={resource.key}><h4>{resource.label}</h4>{!(records[resource.key]||[]).length?<p>No records returned.</p>:<div className="native-workflow-table"><table><thead><tr><th>Record</th><th>Reference</th><th>Details</th></tr></thead><tbody>{records[resource.key].map(row=><tr key={row.id}><td>{row.name||row.title||row.productName||row.first_name||resource.label}</td><td>{row.id}</td><td><button type="button" onClick={()=>setSelected({resource,row})}>Open record</button></td></tr>)}</tbody></table></div>}</article>)}</section>{selected&&<RecordDialog key={selected.row.id} selected={selected} close={()=>setSelected(null)} request={request} reload={loadRecords}/>}
    <section className="native-workflow-records" aria-label="Saved AI history"><h3>Saved AI history</h3><button type="button" onClick={loadHistory}>Refresh history</button>{historyError&&<p role="alert">{historyError}</p>}{history.length===0?<p>No saved AI results returned.</p>:<div className="native-workflow-table"><table><thead><tr><th>Tool</th><th>Saved</th><th>Result</th></tr></thead><tbody>{history.map(item=><tr key={item.id}><td>{item.endpoint}</td><td>{item.created_at ? new Date(item.created_at).toLocaleString() : 'Unknown'}</td><td><button type="button" onClick={()=>openSaved(item.id)}>View report</button></td></tr>)}</tbody></table></div>}{savedResult&&<div className="native-workflow-saved-result"><button type="button" onClick={()=>setSavedResult(null)}>Close saved report</button><NativeAIReport response={savedResult.result} title={'Saved '+(savedResult.endpoint||'AI report')} /></div>}</section></section>;
}
