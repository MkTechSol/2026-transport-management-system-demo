import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, KeyRound, LogOut, Menu, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@gasman/shared';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NAV } from '../lib/nav';
import { Button } from '../ui/Button';
import { Field } from '../ui/Form';
import { Alert } from '../ui/Feedback';
import { ConfirmDialog, Modal } from '../ui/Overlay';
import { useToast } from '../ui/Toast';
import { useAction } from '../lib/hooks';
import { GlobalSearch } from './GlobalSearch';
import { AssistantButton } from './Assistant';

function Logo() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-sm font-extrabold tracking-tight text-navy-900">GM</div>
      <div className="leading-tight"><p className="text-base font-bold text-white">GASMAN</p><p className="text-[11px] uppercase tracking-widest text-slate-400">Transport Mgmt</p></div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, can } = useAuth();
  const demo = useQuery({ queryKey: ['/demo/status'], queryFn: () => get('/demo/status'), staleTime: Infinity });
  const { toast } = useToast(); const [confirm, setConfirm] = useState(false);
  const reset = useAction(() => post('/demo/reset'), { success: 'Demo data restored.', onSuccess: () => { setConfirm(false); setTimeout(() => window.location.assign('/'), 600); } });
  void toast;
  return (
    <div className="flex h-full flex-col bg-navy-900">
      <Logo />
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV.map((g) => {
          const items = g.items.filter((i) => (!i.perm || can(...i.perm)) && (!i.roles || i.roles.includes(user!.role)) && !i.hideFor?.includes(user!.role));
          if (!items.length) return null;
          return (
            <div key={g.title} className="mb-4">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{g.title}</p>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate}
                  className={({ isActive }) => clsx('group relative mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white')}>
                  <i.icon className="h-[18px] w-[18px] shrink-0" />{i.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        {can('demo:reset') && demo.data?.demo && (
          <button onClick={() => setConfirm(true)} className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"><RotateCcw className="h-4 w-4" />Reset demo data</button>
        )}
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300"><span className="h-2 w-2 rounded-full bg-green-400" />All systems operational</div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => reset.mutate(undefined as never)} loading={reset.isPending} danger title="Reset demo data?" confirmLabel="Reset"
        message="This restores the original seeded demo fleet, drivers, distributors and trips. Any changes made during testing will be lost." />
    </div>
  );
}

function Bell_() {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ['/notifications/unread-count'], queryFn: () => get('/notifications/unread-count'), refetchInterval: 30_000, enabled: can('notifications:view') });
  const n = data?.count ?? 0;
  return (
    <Link to="/notifications" aria-label={`Notifications${n ? `, ${n} unread` : ''}`} className="relative rounded-lg p-2 text-white/90 hover:bg-white/15">
      <Bell className="h-5 w-5" />
      {n > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-amber-400 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-navy-900">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  const m = useAction(() => post('/auth/change-password', { currentPassword: cur, newPassword: next }), { success: 'Password changed. Please sign in again.', onSuccess: () => { onClose(); setTimeout(() => window.location.assign('/login'), 800); } });
  return (
    <Modal open={open} onClose={onClose} title="Change password" size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Update password</Button></>}>
      <div className="space-y-3">
        {m.error && <Alert tone="danger">{m.error.fields?.newPassword ?? m.error.message}</Alert>}
        <Field label="Current password">{(id) => <input id={id} type="password" autoComplete="current-password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
        <Field label="New password" hint="At least 10 characters.">{(id) => <input id={id} type="password" autoComplete="new-password" className="input" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function UserMenu() {
  const { user, logout } = useAuth(); const nav = useNavigate();
  const [open, setOpen] = useState(false); const [pw, setPw] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c); }, []);
  const initials = user!.name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-lg p-1 pr-2 hover:bg-white/15" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-brand-700">{initials}</span>
        <span className="hidden text-left leading-tight md:block"><span className="block text-sm font-semibold text-white">{user!.name}</span><span className="block text-[11px] text-white/75">{ROLE_LABELS[user!.role]}</span></span>
        <ChevronDown className="hidden h-4 w-4 text-white/70 md:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-line bg-white p-1.5 text-ink shadow-pop">
          <div className="border-b border-line px-3 py-2"><p className="truncate text-sm font-semibold">{user!.name}</p><p className="truncate text-xs text-slate-500">{user!.email}</p></div>
          <button role="menuitem" onClick={() => { setOpen(false); setPw(true); }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><KeyRound className="h-4 w-4 text-slate-500" />Change password</button>
          <button role="menuitem" onClick={async () => { await logout(); nav('/login'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><LogOut className="h-4 w-4 text-slate-500" />Sign out</button>
        </div>
      )}
      <ChangePassword open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

export function Layout() {
  const [drawer, setDrawer] = useState(false); const loc = useLocation();
  const { user } = useAuth();
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [loc.pathname]);
  const demo = useQuery({ queryKey: ['/demo/status'], queryFn: () => get('/demo/status'), staleTime: Infinity });
  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block"><div className="fixed inset-y-0 w-64"><Sidebar /></div></aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} aria-hidden />
          <div className="relative h-full w-72 max-w-[85vw]"><button aria-label="Close menu" onClick={() => setDrawer(false)} className="absolute right-2 top-3 z-10 rounded p-1 text-white/80"><X className="h-5 w-5" /></button><Sidebar onNavigate={() => setDrawer(false)} /></div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-brand-600 px-3 py-2.5 shadow-sm sm:px-5">
          <button aria-label="Open menu" onClick={() => setDrawer(true)} className="rounded-lg p-2 text-white hover:bg-white/15 lg:hidden"><Menu className="h-5 w-5" /></button>
          <div className="hidden xl:block"><p className="text-sm font-semibold leading-tight text-white">GASMAN TRANSPORT</p><p className="text-[11px] leading-tight text-white/75">LPG Logistics · {new Date().getFullYear()}</p></div>
          <div className="flex flex-1 justify-center"><GlobalSearch /></div>
          {demo.data?.demo && <span className="hidden rounded border border-white/60 px-2 py-1 text-[10px] font-bold tracking-widest text-white sm:inline">DEMO</span>}
          <AssistantButton />
          <Bell_ />
          <UserMenu />
        </header>
        {demo.data?.demo && user?.role !== 'DRIVER' && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-1.5 text-center text-xs text-amber-900 sm:text-left">
            <b>Client demo environment</b> — all data is synthetic. GPS tracking is simulated. Actions you take here are real within this demo database.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-5 sm:px-6"><Outlet /></main>
      </div>
    </div>
  );
}
