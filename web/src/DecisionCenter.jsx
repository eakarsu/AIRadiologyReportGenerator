import React, { useEffect, useMemo, useState } from 'react';

const profile = {
  "title": "Radiology Review Decision Center",
  "outcome": "Studies coordinated",
  "unit": "reports/shift"
};
const seedItems = [
  {
    "id": "rad-101",
    "task": "Escalate critical finding for immediate acknowledgment",
    "owner": "Radiologist",
    "priority": "Critical",
    "status": "In progress",
    "approval": "Pending",
    "evidence": true,
    "escalated": true,
    "due": "2026-08-15",
    "source": "Study ST-440",
    "impact": 28,
    "createdAt": "2026-08-14T13:00:00.000Z",
    "updatedAt": "2026-08-15T13:00:00.000Z"
  },
  {
    "id": "rad-102",
    "task": "Approve structured report after prior-study comparison",
    "owner": "Attending",
    "priority": "High",
    "status": "Review",
    "approval": "Pending",
    "evidence": true,
    "escalated": false,
    "due": "2026-08-15",
    "source": "Draft RPT-82",
    "impact": 21,
    "createdAt": "2026-08-14T13:00:00.000Z",
    "updatedAt": "2026-08-15T13:00:00.000Z"
  },
  {
    "id": "rad-103",
    "task": "Resolve missing clinical indication before finalization",
    "owner": "Imaging Coordinator",
    "priority": "High",
    "status": "Queued",
    "approval": "Not required",
    "evidence": false,
    "escalated": false,
    "due": "2026-08-16",
    "source": "Order ORD-19",
    "impact": 14,
    "createdAt": "2026-08-14T13:00:00.000Z",
    "updatedAt": "2026-08-15T13:00:00.000Z"
  },
  {
    "id": "rad-104",
    "task": "Close communication loop with acknowledgment evidence",
    "owner": "Care Team",
    "priority": "Medium",
    "status": "Done",
    "approval": "Approved",
    "evidence": true,
    "escalated": false,
    "due": "2026-08-14",
    "source": "Alert ALT-71",
    "impact": 8,
    "createdAt": "2026-08-14T13:00:00.000Z",
    "updatedAt": "2026-08-15T13:00:00.000Z"
  }
];

const statuses = ['Queued', 'In progress', 'Review', 'Done'];
const priorities = ['Critical', 'High', 'Medium', 'Low'];
const approvals = ['Not required', 'Pending', 'Approved', 'Rejected'];
const fieldStyle = { padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', minWidth: 0 };
const buttonStyle = { ...fieldStyle, cursor: 'pointer', fontWeight: 700 };
const storageKey = 'AIRadiologyReportGenerator-decision-center';
const apiUrl = '/api/portfolio-operations/' + encodeURIComponent(storageKey);

function newAudit(message) {
  return { id: 'audit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), message, at: new Date().toISOString() };
}

function loadWorkspace() {
  const fallback = { items: seedItems, audit: [newAudit('Domain decision workspace initialized')] };
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed.items) && Array.isArray(parsed.audit) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function csvCell(value) {
  return '"' + String(value ?? '').replaceAll('"', '""') + '"';
}

export default function CodexOperationsFeature() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [confidence, setConfidence] = useState(72);
  const [syncState, setSyncState] = useState('Saved locally');
  const [errors, setErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ task: '', owner: '', priority: 'Medium', due: '', source: '', impact: 5 });

  const items = workspace.items;
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (item) => item.status !== 'Done' && item.due && item.due < today;

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
      setSyncState((current) => current === 'Syncing…' ? current : 'Saved locally');
    } catch {
      setSyncState('Storage unavailable');
    }
  }, [workspace]);

  useEffect(() => {
    let active = true;
    fetch(apiUrl, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('API unavailable')))
      .then((payload) => {
        if (active && Array.isArray(payload.items)) {
          setWorkspace({ items: payload.items, audit: Array.isArray(payload.audit) ? payload.audit : [] });
          setSyncState('Loaded from API');
        }
      })
      .catch(() => {
        if (active) setSyncState('Saved locally · API ready');
      });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      const textMatch = !normalized || Object.values(item).join(' ').toLowerCase().includes(normalized);
      const statusMatch = statusFilter === 'All' || item.status === statusFilter;
      const priorityMatch = priorityFilter === 'All' || item.priority === priorityFilter;
      return textMatch && statusMatch && priorityMatch;
    });
  }, [items, priorityFilter, query, statusFilter]);

  const metrics = useMemo(() => {
    const open = items.filter((item) => item.status !== 'Done').length;
    const urgent = items.filter((item) => item.status !== 'Done' && ['Critical', 'High'].includes(item.priority)).length;
    const overdue = items.filter(isOverdue).length;
    const evidence = items.length ? Math.round(items.filter((item) => item.evidence).length / items.length * 100) : 0;
    const pending = items.filter((item) => item.approval === 'Pending').length;
    const impact = Math.round(items.reduce((sum, item) => sum + Number(item.impact || 0), 0) * confidence / 100);
    return { open, urgent, overdue, evidence, pending, impact };
  }, [confidence, items]);

  const alerts = useMemo(
    () => items.filter((item) => isOverdue(item) || item.escalated || (item.priority === 'Critical' && item.status !== 'Done')),
    [items],
  );

  function commit(nextItems, message) {
    setWorkspace((current) => ({
      items: typeof nextItems === 'function' ? nextItems(current.items) : nextItems,
      audit: [newAudit(message), ...current.audit].slice(0, 60),
    }));
  }

  function validate() {
    const next = {};
    if (!form.task.trim()) next.task = 'A work item is required.';
    if (!form.owner.trim()) next.owner = 'An accountable owner is required.';
    if (!form.due) next.due = 'An SLA date is required.';
    if (!form.source.trim()) next.source = 'Evidence source or system is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submitTask(event) {
    event.preventDefault();
    if (!validate()) return;
    if (editingId) {
      commit(
        (current) => current.map((item) => item.id === editingId ? { ...item, ...form, impact: Number(form.impact), updatedAt: new Date().toISOString() } : item),
        'Updated work item: ' + form.task.trim(),
      );
    } else {
      const item = {
        id: 'work-' + Date.now(),
        ...form,
        impact: Number(form.impact),
        status: 'Queued',
        approval: 'Pending',
        evidence: false,
        escalated: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      commit((current) => [item, ...current], 'Created work item: ' + form.task.trim());
    }
    setEditingId(null);
    setErrors({});
    setForm({ task: '', owner: '', priority: 'Medium', due: '', source: '', impact: 5 });
  }

  function updateItem(id, changes, message) {
    commit(
      (current) => current.map((item) => item.id === id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item),
      message,
    );
  }

  function editItem(item) {
    setEditingId(item.id);
    setForm({ task: item.task, owner: item.owner, priority: item.priority, due: item.due, source: item.source, impact: item.impact });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function removeItem(item) {
    if (!window.confirm('Remove this work item?')) return;
    commit((current) => current.filter((row) => row.id !== item.id), 'Removed work item: ' + item.task);
  }

  async function syncApi() {
    setSyncState('Syncing…');
    try {
      const response = await fetch(apiUrl, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workspace),
      });
      if (!response.ok) throw new Error('API unavailable');
      const payload = await response.json();
      if (Array.isArray(payload.items)) setWorkspace({ items: payload.items, audit: payload.audit || workspace.audit });
      setSyncState('API synchronized');
    } catch {
      setSyncState('Saved locally · API unavailable');
    }
  }

  function exportCsv() {
    const fields = ['id', 'task', 'owner', 'priority', 'status', 'approval', 'escalated', 'evidence', 'source', 'due', 'impact', 'updatedAt'];
    const csv = [fields.join(','), ...items.map((item) => fields.map((field) => csvCell(item[field])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = storageKey + '-work-queue.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const metricCards = [
    ['Open work', metrics.open, 'Items requiring action'],
    ['High-risk queue', metrics.urgent, 'Critical or high priority'],
    ['Overdue SLAs', metrics.overdue, 'Immediate exception handling'],
    ['Evidence coverage', metrics.evidence + '%', 'Items with source proof'],
    ['Pending approvals', metrics.pending, 'Human decisions required'],
    [profile.outcome, metrics.impact, profile.unit + ' at ' + confidence + '% confidence'],
  ];

  return (
    <section style={{ padding: 24, color: '#172033', maxWidth: 1380, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#64748b', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>Governed operational intelligence</p>
          <h1 style={{ margin: '6px 0', fontSize: 30 }}>{profile.title}</h1>
          <p style={{ margin: 0, color: '#64748b' }}>Prioritize work, model outcomes, preserve evidence, and keep consequential actions under human control.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={syncApi} style={buttonStyle}>Sync API</button>
          <button type="button" onClick={exportCsv} style={buttonStyle}>Export CSV</button>
          <button type="button" onClick={() => window.print()} style={buttonStyle}>Print / PDF</button>
          <button type="button" onClick={() => setWorkspace({ items: seedItems, audit: [newAudit('Demo workspace reset')] })} style={buttonStyle}>Reset demo</button>
        </div>
      </div>
      <div style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>{syncState}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12, margin: '18px 0' }}>
        {metricCards.map(([label, value, note]) => (
          <article key={label} style={{ padding: 15, border: '1px solid #dbe3ef', borderRadius: 12, background: '#fff' }}>
            <div style={{ color: '#64748b', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
            <strong style={{ display: 'block', fontSize: 27, margin: '5px 0' }}>{value}</strong>
            <small style={{ color: '#64748b' }}>{note}</small>
          </article>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 2fr) minmax(220px, 1fr)', gap: 14, marginBottom: 16 }}>
        <div style={{ padding: 16, border: '1px solid #dbe3ef', borderRadius: 12, background: '#f8fafc' }}>
          <label htmlFor="confidence" style={{ fontWeight: 700 }}>Scenario confidence: {confidence}%</label>
          <input id="confidence" type="range" min="10" max="100" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} style={{ width: '100%', marginTop: 10 }} />
          <small style={{ color: '#64748b' }}>Projected {profile.outcome.toLowerCase()}: {metrics.impact} {profile.unit}. This is a planning estimate, not an automated decision.</small>
        </div>
        <div style={{ padding: 16, border: alerts.length ? '1px solid #f59e0b' : '1px solid #dbe3ef', borderRadius: 12, background: alerts.length ? '#fffbeb' : '#f8fafc' }}>
          <strong>{alerts.length} active exception{alerts.length === 1 ? '' : 's'}</strong>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>{alerts.slice(0, 2).map((item) => item.task).join(' · ') || 'No overdue, escalated, or critical work.'}</div>
        </div>
      </div>

      <form onSubmit={submitTask} noValidate style={{ padding: 16, border: '1px solid #dbe3ef', borderRadius: 12, marginBottom: 16 }}>
        <strong>{editingId ? 'Edit work item' : 'Create work item'}</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 2fr) minmax(150px, 1fr) 125px 150px minmax(180px, 1fr) 100px auto', gap: 9, marginTop: 12 }}>
          <input aria-label="Work item" value={form.task} onChange={(event) => setForm({ ...form, task: event.target.value })} placeholder="Decision, investigation, or follow-up" style={fieldStyle} />
          <input aria-label="Owner" value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="Accountable owner" style={fieldStyle} />
          <select aria-label="Priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} style={fieldStyle}>{priorities.map((value) => <option key={value}>{value}</option>)}</select>
          <input aria-label="SLA due date" type="date" value={form.due} onChange={(event) => setForm({ ...form, due: event.target.value })} style={fieldStyle} />
          <input aria-label="Evidence source" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="Source system / evidence reference" style={fieldStyle} />
          <input aria-label="Expected impact" type="number" min="0" value={form.impact} onChange={(event) => setForm({ ...form, impact: event.target.value })} style={fieldStyle} />
          <button type="submit" style={{ ...buttonStyle, border: 0, background: '#172033', color: '#fff' }}>{editingId ? 'Save' : 'Add'}</button>
        </div>
        {Object.keys(errors).length > 0 && <div role="alert" style={{ color: '#b91c1c', marginTop: 9 }}>{Object.values(errors).join(' ')}</div>}
      </form>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 160px 160px', gap: 10, marginBottom: 14 }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search task, owner, evidence source, or date" style={fieldStyle} />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={fieldStyle}><option>All</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} style={fieldStyle}><option>All</option>{priorities.map((value) => <option key={value}>{value}</option>)}</select>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #d7dde8', borderRadius: 10, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1240 }}>
          <thead><tr style={{ background: '#f1f5f9', textAlign: 'left' }}>{['Work item', 'Owner', 'Priority', 'Status', 'Approval', 'SLA', 'Evidence', 'Escalate', 'Actions'].map((heading) => <th key={heading} style={{ padding: 11 }}>{heading}</th>)}</tr></thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} style={{ borderTop: '1px solid #e2e8f0', background: isOverdue(item) ? '#fff7ed' : '#fff' }}>
                <td style={{ padding: 11 }}><strong>{item.task}</strong><small style={{ display: 'block', color: '#64748b', marginTop: 4 }}>{item.source}</small></td>
                <td style={{ padding: 11 }}>{item.owner}</td>
                <td style={{ padding: 11 }}>{item.priority}</td>
                <td style={{ padding: 7 }}><select value={item.status} onChange={(event) => updateItem(item.id, { status: event.target.value }, 'Changed status for ' + item.task)} style={fieldStyle}>{statuses.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td style={{ padding: 7 }}><select value={item.approval} onChange={(event) => updateItem(item.id, { approval: event.target.value }, 'Recorded approval decision for ' + item.task)} style={fieldStyle}>{approvals.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td style={{ padding: 11, color: isOverdue(item) ? '#b91c1c' : 'inherit', fontWeight: isOverdue(item) ? 700 : 400 }}>{item.due}{isOverdue(item) ? ' · overdue' : ''}</td>
                <td style={{ padding: 11, textAlign: 'center' }}><input aria-label={'Evidence verified for ' + item.task} type="checkbox" checked={Boolean(item.evidence)} onChange={(event) => updateItem(item.id, { evidence: event.target.checked }, 'Updated evidence verification for ' + item.task)} /></td>
                <td style={{ padding: 11, textAlign: 'center' }}><input aria-label={'Escalate ' + item.task} type="checkbox" checked={Boolean(item.escalated)} onChange={(event) => updateItem(item.id, { escalated: event.target.checked }, 'Updated escalation for ' + item.task)} /></td>
                <td style={{ padding: 9, whiteSpace: 'nowrap' }}><button type="button" onClick={() => editItem(item)} style={{ border: 0, background: 'transparent', color: '#1d4ed8', cursor: 'pointer' }}>Edit</button><button type="button" onClick={() => removeItem(item)} style={{ border: 0, background: 'transparent', color: '#b91c1c', cursor: 'pointer' }}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <div style={{ padding: 18, color: '#64748b' }}>No work items match the selected filters.</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)', gap: 14, marginTop: 16 }}>
        <section style={{ padding: 16, border: '1px solid #dbe3ef', borderRadius: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Evidence and source lineage</h2>
          {items.slice(0, 5).map((item) => <div key={item.id} style={{ padding: '8px 0', borderTop: '1px solid #eef2f7' }}><strong>{item.evidence ? 'Verified' : 'Pending'}</strong> · {item.source}<small style={{ display: 'block', color: '#64748b' }}>{item.task}</small></div>)}
        </section>
        <section style={{ padding: 16, border: '1px solid #dbe3ef', borderRadius: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Immutable-style activity history</h2>
          {workspace.audit.slice(0, 6).map((entry) => <div key={entry.id} style={{ padding: '8px 0', borderTop: '1px solid #eef2f7' }}><strong>{entry.message}</strong><small style={{ display: 'block', color: '#64748b' }}>{new Date(entry.at).toLocaleString()}</small></div>)}
        </section>
      </div>
    </section>
  );
}
