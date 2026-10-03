import { useState } from 'react';
import './WorkflowSidebar.css';

export default function WorkflowSidebar({ title, features }) {
  const [query, setQuery] = useState('');
  const sections = [
    { id: 'overview', label: 'Overview' },
    ...features.map((label, index) => ({ id: `step-${index + 1}`, label })),
  ].filter(section => section.label.toLowerCase().includes(query.toLowerCase().trim()));

  return <aside className="codex-workflow-side" aria-label="Application navigation">
    <div className="codex-workflow-brand"><strong>{title}</strong><span>Workspace</span></div>
    <label htmlFor="codex-workflow-search">Find a section</label>
    <input id="codex-workflow-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search navigation" />
    <nav aria-label="Sections">
      {sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
      {sections.length === 0 && <p>No matching sections</p>}
    </nav>
  </aside>;
}
