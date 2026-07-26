import { useEffect, useState } from 'react';
import './App.css';

const FEATURES = [
  "Open the study worklist",
  "Draft a structured report",
  "Route critical findings for review"
];
const PRODUCT_NAME = 'AI Radiology Report Generator';
const configuredApiBase = process.env.REACT_APP_API_URL || '';
const API_BASE = typeof window === 'undefined' ? configuredApiBase : configuredApiBase.replace(/127\.0\.0\.1|localhost/, window.location.hostname);

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed with HTTP ${response.status}`);
  return body;
}

export default function App() {
  const [service, setService] = useState({ status: 'loading', detail: 'Checking the API boundary…' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    api('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then((body) => setUser(body.user || body)).catch(() => localStorage.removeItem('authToken'));
  }, []);

  const fillDemoCredentials = async () => { setError(''); setBusy(true); try { const credentials = await api('/api/auth/demo-credentials'); setEmail(credentials.email); setPassword(credentials.password); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  const handleLogin = async (event) => { event.preventDefault(); setError(''); setBusy(true); try { const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); localStorage.setItem('authToken', result.token); const identity = await api('/api/auth/me', { headers: { Authorization: `Bearer ${result.token}` } }); setUser(identity.user || identity); } catch (requestError) { localStorage.removeItem('authToken'); setError(requestError.message); } finally { setBusy(false); } };

  if (!user) return <main className="login-shell"><form className="login-card" onSubmit={handleLogin}><p className="eyebrow">{PRODUCT_NAME}</p><h1>Sign in to your workspace</h1><p className="lede">Use the provisioned local account to continue.</p>{error && <p className="form-error" role="alert">{error}</p>}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label><button className="demo-button" type="button" onClick={fillDemoCredentials} disabled={busy}>Auto Fill Demo Credentials</button><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign In'}</button></form></main>;

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
