import { ShieldCheck, Truck, MapPinned } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@gasman/shared';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { TextInput } from '../ui/Form';

const DEMO = [
  ['SUPER_ADMIN', 'superadmin@gasman-demo.local'], ['TRANSPORT_MANAGER', 'transport.manager@gasman-demo.local'], ['DISPATCHER', 'dispatcher@gasman-demo.local'],
  ['FLEET_MANAGER', 'fleet.manager@gasman-demo.local'], ['DRIVER', 'driver@gasman-demo.local'], ['MANAGEMENT_VIEWER', 'management@gasman-demo.local'],
] as const;
const DEMO_PASSWORD = 'GasMan@Demo2026';

export default function Login() {
  const { user, login } = useAuth(); const nav = useNavigate(); const loc = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={(loc.state as any)?.from ?? '/'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const u = await login(email.trim(), password); nav(u.role === 'DRIVER' ? '/driver' : (loc.state as any)?.from ?? '/', { replace: true }); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not sign in. Please try again.'); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-12 text-white lg:flex">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full border border-white/5" /><div className="absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full border border-white/5" />
        <div className="relative flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-base font-extrabold text-navy-900">GM</div><div><p className="text-lg font-bold leading-tight">GASMAN</p><p className="text-xs uppercase tracking-widest text-slate-400">Private Limited</p></div></div>
        <div className="relative">
          <h1 className="text-4xl font-semibold leading-tight">LPG Transportation<br />Management System</h1>
          <p className="mt-4 max-w-md text-lg text-slate-300">Control operations. Connect teams. Deliver with confidence.</p>
          <ul className="mt-10 space-y-4 text-sm text-slate-300">
            <li className="flex items-center gap-3"><Truck className="h-5 w-5 text-brand-500" />Plan, assign and dispatch bowzer trips with built-in compliance checks</li>
            <li className="flex items-center gap-3"><MapPinned className="h-5 w-5 text-brand-500" />Track every vehicle from plant to distributor in real time</li>
            <li className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-brand-500" />Safety checklists, document expiry and incident reporting</li>
          </ul>
        </div>
        <p className="relative text-xs uppercase tracking-widest text-slate-500">Demo environment · Powered by MK TechSol</p>
      </div>
      <div className="flex items-center justify-center bg-white px-6 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-900 text-sm font-extrabold text-white">GM</div><p className="text-lg font-bold">GASMAN TMS</p></div>
          <h2 className="text-2xl font-semibold">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue to the Operational Control Tower.</p>
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {err && <Alert tone="danger">{err}</Alert>}
            <TextInput label="Work email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gasman-demo.local" autoFocus />
            <TextInput label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" variant="primary" className="w-full py-2.5" loading={busy} disabled={!email || !password}>Sign in</Button>
          </form>
          <div className="mt-6 rounded-xl border border-line bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-700">Fictional demo accounts <span className="font-normal text-slate-500">— click a role to fill</span></p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {DEMO.map(([r, e]) => (
                <button key={r} type="button" onClick={() => { setEmail(e); setPassword(DEMO_PASSWORD); setErr(''); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-brand-500 hover:bg-brand-50">
                  <span className="block font-semibold text-ink">{ROLE_LABELS[r]}</span><span className="block truncate text-slate-500">{e.split('@')[0]}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-500">Password for all demo accounts: <code className="rounded bg-white px-1 py-0.5 font-mono text-slate-700">{DEMO_PASSWORD}</code></p>
          </div>
          <p className="mt-4 text-center text-[11px] text-slate-400">This is a safe demonstration. All data is synthetic; no production transactions are processed.</p>
        </div>
      </div>
    </div>
  );
}
