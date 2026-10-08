import { Copy, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Drawer } from '../ui/Overlay';
import { useToast } from '../ui/Toast';
import { money } from './finance';

interface Msg { from: 'me' | 'bot'; text: string; data?: any }
const START = ['Give me today’s briefing', 'Which trips are delayed?', 'Who owes us the most?', 'Show low-stock items', 'What expires in the next 30 days?', 'Which bowzers made the most profit this month?'];

export function AssistantButton() {
  const { can } = useAuth(); const [open, setOpen] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); setOpen((o) => !o); } }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, []);
  if (!can('ai:use')) return null;
  return <>
    <button onClick={() => setOpen(true)} aria-label="Ask GasMan assistant" title="Ask GasMan (Ctrl+/)" className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-sm font-medium text-white hover:bg-white/25"><Sparkles className="h-4 w-4" /><span className="hidden md:inline">Ask GasMan</span></button>
    {open && <AssistantPanel onClose={() => setOpen(false)} />}
  </>;
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast(); const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  const send = async (q: string) => {
    const question = q.trim(); if (!question || busy) return; setText(''); setMsgs((m) => [...m, { from: 'me', text: question }]); setBusy(true);
    try { const r = await post('/assistant/ask', { question }); setMsgs((m) => [...m, { from: 'bot', text: r.answer, data: r }]); } catch (e: any) { setMsgs((m) => [...m, { from: 'bot', text: e.message ?? 'Something went wrong.' }]); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} width="max-w-xl" title="Ask GasMan" description="Demo assistant — answers come from your live data using built-in rules, not a language model. It never changes anything.">
      <div className="flex min-h-[60vh] flex-col gap-3">
        {!msgs.length && <div className="space-y-2"><p className="text-sm text-slate-600">Ask about trips, bowzers, fuel, approvals, receivables, stock or documents. For example:</p><div className="flex flex-wrap gap-2">{START.map((s) => <button key={s} className="rounded-full border border-line bg-white px-3 py-1.5 text-sm hover:bg-brand-50" onClick={() => send(s)}>{s}</button>)}</div></div>}
        {msgs.map((m, i) => m.from === 'me' ? <div key={i} className="self-end rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-sm text-white">{m.text}</div> : (
          <div key={i} className="max-w-full self-start rounded-2xl rounded-bl-sm border border-line bg-white px-4 py-3 text-sm shadow-sm">
            <p className="whitespace-pre-line">{m.text}</p>
            {m.data?.rows?.length > 0 && <div className="mt-2 overflow-x-auto rounded-lg border border-line"><table className="w-full text-xs"><thead className="bg-slate-50"><tr>{m.data.columns.map((c: any) => <th key={c.key} className={`px-2 py-1.5 text-left font-medium text-slate-500 ${c.type ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{m.data.rows.map((r: any, k: number) => <tr key={k}>{m.data.columns.map((c: any) => <td key={c.key} className={`px-2 py-1.5 ${c.type ? 'text-right tabular-nums' : ''}`}>{c.type === 'money' ? money(r[c.key]) : c.type === 'num' ? (r[c.key] ?? '—') : r[c.key]}</td>)}</tr>)}</tbody></table></div>}
            <div className="mt-2 flex flex-wrap items-center gap-3">{m.data?.link && <Link onClick={onClose} to={m.data.link.to} className="text-xs font-medium text-brand-700 hover:underline">{m.data.link.label} →</Link>}
              {m.data?.intent === 'briefing' && <button className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-brand-700" onClick={() => { navigator.clipboard?.writeText(m.text); toast('success', 'Briefing copied — paste it into WhatsApp or email.'); }}><Copy className="h-3 w-3" />Copy text</button>}</div>
            {m.data?.suggestions && <div className="mt-2 flex flex-wrap gap-2">{m.data.suggestions.map((s: string) => <button key={s} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-brand-50" onClick={() => send(s)}>{s}</button>)}</div>}
          </div>))}
        {busy && <div className="self-start rounded-2xl border border-line bg-white px-4 py-2 text-sm text-slate-500">Looking that up…</div>}
        <div ref={end} />
      </div>
      <form className="sticky bottom-0 mt-3 flex gap-2 bg-white pt-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input aria-label="Ask a question" className="input" placeholder="Ask a question… e.g. status of TRP-2026-0180" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} autoFocus />
        <button type="submit" aria-label="Send question" className="rounded-lg bg-brand-600 px-3 text-white hover:bg-brand-700 disabled:opacity-50" disabled={busy || !text.trim()}><Send className="h-4 w-4" /></button>
      </form>
    </Drawer>
  );
}
