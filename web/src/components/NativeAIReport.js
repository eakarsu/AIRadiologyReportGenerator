import React, { useState, useRef } from 'react';
import './NativeAIReport.css';

const metadata = new Set(['ok', 'id', 'model', 'model_used', 'tokens_used', 'tokensUsed', 'usage', 'receipt', 'created_at', 'updated_at', 'user_id', 'input', 'feature']);
export const readableLabel = (key) => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

export function reportValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
    if (/^(?:\[|\{)/.test(trimmed)) {
      try { return reportValue(JSON.parse(trimmed)); } catch (_) { /* Preserve ordinary prose. */ }
    }
    return value;
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') return value;
  for (const key of ['result_json', 'structured', 'parsed']) {
    if (value[key] && typeof value[key] === 'object') return value[key];
  }
  for (const key of ['raw', 'content', 'ai_response', 'response', 'result', 'output']) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') return reportValue(value[key]);
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => !metadata.has(key)));
}

export function reportText(value, depth = 0) {
  if (value === null || value === undefined) return 'Not provided';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((item) => `${'  '.repeat(depth)}• ${reportText(item, depth + 1)}`).join('\n');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${readableLabel(key)}\n${reportText(item, depth + 1)}`).join('\n\n');
  return String(value);
}

function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function Prose({ text }) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^```/.test(line)) {
      const start = index; const language = line.slice(3).trim().toLowerCase(); const content = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) content.push(lines[index++]);
      if (index < lines.length) index++;
      if (language === 'json') {
        try { blocks.push(<Value key={start} value={JSON.parse(content.join('\n'))} />); }
        catch (_) { blocks.push(<p key={start} className="ai-muted">The provider returned incomplete structured content. Generate the report again.</p>); }
      } else blocks.push(<pre className="ai-report-code" key={start}><code>{content.join('\n')}</code></pre>);
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={index} />); index++; continue; }
    const heading = line.match(/^#{1,6}\s+(.+)/);
    if (heading) { blocks.push(<h3 key={index}><Inline text={heading[1]} /></h3>); index++; continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || '')) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const headers = cells(line); const rows = []; const start = index; index += 2;
      while (index < lines.length && lines[index].includes('|')) rows.push(cells(lines[index++]));
      blocks.push(<div className="ai-report-table-wrap" key={start}><table className="ai-report-table"><thead><tr>{headers.map((cell, i) => <th key={i}><Inline text={cell} /></th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}><Inline text={cell} /></td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line); const items = []; const start = index;
      while (index < lines.length && /^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={start}>{items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</List>);
      continue;
    }
    const paragraphs = [line]; const start = index++;
    while (index < lines.length && lines[index].trim() && !/^\s*(?:#|[-*•]\s|\d+[.)]\s|```|-{3,}|\*{3,}|_{3,})/.test(lines[index]) && !(lines[index].includes('|') && /-{3,}/.test(lines[index + 1] || ''))) paragraphs.push(lines[index++]);
    blocks.push(<p key={start}><Inline text={paragraphs.join('\n')} /></p>);
  }
  return blocks;
}

function Value({ value, depth = 0 }) {
  if (depth > 10) return <p>{reportText(value)}</p>;
  if (value === '') return <p className="ai-muted">Empty string</p>;
  if (typeof value === 'string') {
    const parsed = reportValue(value);
    if (parsed && typeof parsed === 'object') return <Value value={parsed} depth={depth + 1} />;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <p className="ai-muted">None reported.</p>;
    const tabular = value.every((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (tabular) {
      const keys = [...new Set(value.flatMap((item) => Object.keys(item)))];
      return <div className="ai-report-table-wrap"><table className="ai-report-table"><thead><tr>{keys.map((key) => <th key={key}>{readableLabel(key)}</th>)}</tr></thead><tbody>{value.map((row, index) => <tr key={index}>{keys.map((key) => <td key={key}><Value value={row[key]} depth={depth + 1} /></td>)}</tr>)}</tbody></table></div>;
    }
    return <ul>{value.map((item, index) => <li key={index}><Value value={item} depth={depth + 1} /></li>)}</ul>;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (depth > 0 && entries.length && entries.every(([, item]) => item === null || (typeof item !== 'object' && typeof reportValue(item) !== 'object' && String(item).length < 120))) return <dl className="ai-report-facts">{entries.map(([key, item]) => <div key={key}><dt>{readableLabel(key)}</dt><dd>{typeof item === 'number' ? item.toLocaleString() : <Inline text={item === '' ? 'Empty string' : reportText(item)} />}</dd></div>)}</dl>;
    return <div className="ai-report-sections">{entries.map(([key, item]) => <section key={key}><h3>{readableLabel(key)}</h3><Value value={item} depth={depth + 1} /></section>)}</div>;
  }
  return <Prose text={reportText(value)} />;
}

export default function AIReport({ response, title = 'AI report', model, tokens, loading, error }) {
  const [copied, setCopied] = useState(false);
  const reportBody = useRef(null);
  if (loading) return <section className="ai-report" role="status"><div className="ai-loading-dot" /><h3>Preparing your report</h3><p>OpenRouter is reviewing your inputs. You can cancel this request.</p></section>;
  if (error) return <div className="ai-alert" role="alert">{error}</div>;
  if (response === null || response === undefined) return null;
  const value = reportValue(response);
  const readableText = () => {
    if (!reportBody.current) return reportText(value);
    const clone = reportBody.current.cloneNode(true);
    clone.querySelectorAll('p,h1,h2,h3,h4,li,dt,dd,tr,section,pre').forEach(node => node.append('\n'));
    clone.querySelectorAll('th,td').forEach(node => node.append('\t'));
    return clone.textContent.replace(/\n{3,}/g, '\n\n').trim();
  };
  const actualModel = model || response?.model || response?.model_used;
  const usage = tokens || response?.usage || response?.tokens_used;
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${title}\n\n${readableText()}\n`], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`; anchor.click(); URL.revokeObjectURL(url);
  };
  return <article className="ai-report"><header className="ai-report-header"><div><span className="ai-eyebrow">OpenRouter response</span><h2>{title}</h2></div><div className="ai-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(readableText()); setCopied(true); } catch (_) { setCopied(false); } }}>{copied ? 'Copied' : 'Copy report'}</button><button type="button" className="btn btn-secondary btn-sm" onClick={download}>Download</button></div></header><div className="ai-report-body" ref={reportBody}><Value value={value} /></div>{(actualModel || usage) && <footer className="ai-report-footer">{actualModel && <span>Model: {actualModel}</span>}{usage && <span>{typeof usage === 'number' ? usage : usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)} tokens</span>}</footer>}</article>;
}
