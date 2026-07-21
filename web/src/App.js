import { useEffect, useState } from 'react';
import './App.css';

const FEATURES = [
  "Open the study worklist",
  "Draft a structured report",
  "Route critical findings for review"
];
const API_BASE = process.env.REACT_APP_API_URL || '';

export default function App() {
  const [service, setService] = useState({ status: 'loading', detail: 'Checking the API boundary…' });

  const checkService = async () => {
    setService({ status: 'loading', detail: 'Checking the API boundary…' });
    try {
      const response = await fetch(`${API_BASE}/api/health`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
      setService({ status: 'ready', detail: 'Backend API is reachable.' });
    } catch (error) {
      setService({ status: 'error', detail: error.message || 'Backend API is unavailable.' });
    }
  };

  useEffect(() => { checkService(); }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Restored application boundary</p>
        <h1>AI Radiology Report Generator</h1>
        <p className="lede">This checked-in UI exposes the primary workflow boundary without presenting generated screens as completed execution.</p>
        <div className={`service service--${service.status}`} role={service.status === 'error' ? 'alert' : 'status'}>
          <span>{service.status === 'loading' ? 'Loading' : service.status === 'ready' ? 'Connected' : 'Unavailable'}</span>
          <p>{service.detail}</p>
          {service.status === 'error' && <button type="button" onClick={checkService}>Retry connection</button>}
        </div>
      </section>
      <section aria-labelledby="workflow-heading">
        <h2 id="workflow-heading">Primary workflow</h2>
        <div className="workflow">
          {FEATURES.map((feature, index) => (
            <article key={feature}>
              <strong>{String(index + 1).padStart(2, '0')}</strong>
              <h3>{feature}</h3>
              <p>Backend integration and validation remain required before this step can execute in production.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
