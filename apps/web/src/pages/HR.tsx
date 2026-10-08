import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, titleCase } from '../lib/format';
import { fieldErrors, useAction, useList, useQueryState } from '../lib/hooks';
import { Button } from '../ui/Button';
import { Alert, ErrorState, PageLoader } from '../ui/Feedback';
import { FilterSelect, SelectInput, TextInput } from '../ui/Form';
import { Drawer, Modal } from '../ui/Overlay';
import { KV, KVGrid, KpiCard, PageHeader, Tabs } from '../ui/Page';
import { StatusPill } from '../ui/Pill';
import { Column, DataTable, FilterBar, SearchInput } from '../ui/Table';
import { money, today, useBanks } from '../features/finance';

const useDepts = () => useQuery({ queryKey: ['/hr/departments'], queryFn: () => get('/hr/departments'), staleTime: 60_000 });

function EmployeeModal({ emp, onClose }: { emp?: any; onClose: () => void }) {
  const { can } = useAuth(); const depts = useDepts(); const pay = can('payroll:manage');
  const [f, setF] = useState({ fullName: emp?.full_name ?? '', departmentId: String(emp?.department_id ?? ''), designation: emp?.designation ?? '', employeeType: emp?.employee_type ?? 'STAFF', phone: emp?.phone ?? '', joinedOn: emp?.joined_on ?? today(), basicSalary: String(emp?.basic_salary ?? ''), allowances: String(emp?.allowances ?? ''), tripRate: String(emp?.trip_rate ?? ''), bankName: emp?.bank_name ?? '', bankAccount: emp?.bank_account ?? '' });
  const set = (k: string) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => ({ fullName: f.fullName, departmentId: f.departmentId ? Number(f.departmentId) : null, designation: f.designation || null, employeeType: f.employeeType, phone: f.phone || null, joinedOn: f.joinedOn, bankName: f.bankName || null, bankAccount: f.bankAccount || null, ...(pay ? { basicSalary: Number(f.basicSalary || 0), allowances: Number(f.allowances || 0), tripRate: Number(f.tripRate || 0) } : {}) });
  const m = useAction(() => (emp ? patch(`/hr/employees/${emp.id}`, body()) : post('/hr/employees', body())), { invalidate: ['/hr'], success: 'Employee saved.', onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} size="lg" title={emp ? `Edit ${emp.full_name}` : 'New employee'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Save (F10)</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">{m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
      <TextInput label="Full name" required value={f.fullName} onChange={set('fullName')} error={fe.fullName} /><SelectInput label="Department" value={f.departmentId} onChange={set('departmentId')} placeholder="—" options={(depts.data?.data ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />
      <TextInput label="Designation" value={f.designation} onChange={set('designation')} /><SelectInput label="Type" value={f.employeeType} onChange={set('employeeType')} options={[{ value: 'STAFF', label: 'Staff' }, { value: 'DRIVER', label: 'Driver' }, { value: 'HELPER', label: 'Helper' }, { value: 'MANAGER', label: 'Manager' }]} />
      <TextInput label="Phone" value={f.phone} onChange={set('phone')} /><TextInput label="Joined on" type="date" value={f.joinedOn} onChange={set('joinedOn')} />
      {pay ? <><TextInput label="Basic salary (PKR / month)" type="number" min="0" value={f.basicSalary} onChange={set('basicSalary')} error={fe.basicSalary} /><TextInput label="Allowances (PKR / month)" type="number" min="0" value={f.allowances} onChange={set('allowances')} error={fe.allowances} />
        <TextInput label="Per-trip bonus (PKR)" type="number" min="0" value={f.tripRate} onChange={set('tripRate')} hint="Paid per completed trip (drivers, helpers)" /><div /><TextInput label="Bank" value={f.bankName} onChange={set('bankName')} /><TextInput label="Account / IBAN" value={f.bankAccount} onChange={set('bankAccount')} /></>
        : <p className="text-xs text-slate-500 sm:col-span-2">Salary figures are visible only to payroll managers.</p>}</div></Modal>;
}

function EmployeesTab() {
  const { can } = useAuth(); const depts = useDepts(); const { state, set, clear, page } = useQueryState(); const [edit, setEdit] = useState<any | null | false>(false);
  const { data, isLoading, error, refetch } = useList('/hr/employees', { page, pageSize: 15, q: state.q, departmentId: state.dep, type: state.type });
  const pay = can('payroll:manage');
  const cols: Column<any>[] = [
    { key: 'name', header: 'Employee', render: (e) => <div><p className="font-semibold text-brand-700">{e.full_name}</p><p className="text-xs text-slate-500">{e.code}</p></div> }, { key: 'des', header: 'Designation', hideBelow: 'md', render: (e) => e.designation }, { key: 'dep', header: 'Department', hideBelow: 'lg', render: (e) => e.department },
    { key: 'type', header: 'Type', render: (e) => titleCase(e.employee_type) }, { key: 'joined', header: 'Joined', hideBelow: 'lg', render: (e) => fmtDate(e.joined_on) },
    ...(pay ? [{ key: 'basic', header: 'Basic', render: (e: any) => <span className="tabular-nums">{money(e.basic_salary)}</span> }] : []),
  ];
  return <>
    <FilterBar active={['q', 'dep', 'type'].some((k) => state[k])} onClear={() => clear()}><SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search name, code, designation…" />
      <FilterSelect label="Department" value={state.dep ?? 'ALL'} onChange={(v) => set({ dep: v })} options={[{ value: 'ALL', label: 'All departments' }, ...(depts.data?.data ?? []).map((d: any) => ({ value: String(d.id), label: `${d.name} (${d.headcount})` }))]} />
      <FilterSelect label="Type" value={state.type ?? 'ALL'} onChange={(v) => set({ type: v })} options={[{ value: 'ALL', label: 'All types' }, ...['STAFF', 'DRIVER', 'HELPER', 'MANAGER'].map((t) => ({ value: t, label: titleCase(t) }))]} />
      {can('hr:manage') && <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(null)}>New employee</Button>}</FilterBar>
    <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(e) => e.id} onRowClick={(e) => can('hr:manage') && setEdit(e)} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No employees match' }} />
    {edit !== false && <EmployeeModal emp={edit ?? undefined} onClose={() => setEdit(false)} />}
  </>;
}

const CELL: Record<string, string> = { P: 'bg-green-100 text-green-800', A: 'bg-red-100 text-red-700', L: 'bg-blue-100 text-blue-700', H: 'bg-amber-100 text-amber-800', OFF: 'bg-slate-100 text-slate-500' };
function AttendanceTab() {
  const { can } = useAuth(); const [month, setMonth] = useState(today().slice(0, 7)); const [q, setQ] = useState('');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/hr/attendance', month, q], queryFn: () => get(`/hr/attendance?month=${month}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const mark = useAction(() => post('/hr/attendance/mark', { date: today(), allPresent: true }), { invalidate: ['/hr'], success: (r: any) => `Marked ${r.marked} employee(s) present for today.` });
  const cycle = useAction((v: { id: number; day: number; status: string }) => post('/hr/attendance/mark', { date: `${month}-${String(v.day).padStart(2, '0')}`, entries: [{ employeeId: v.id, status: v.status }] }), { invalidate: ['/hr'] });
  const next: Record<string, string> = { P: 'A', A: 'H', H: 'P', L: 'P', '': 'P' };
  return <>
    <div className="mb-3 flex flex-wrap items-end gap-3"><label className="text-xs font-medium text-slate-600">Month<input type="month" className="input mt-1" value={month} onChange={(e) => setMonth(e.target.value)} /></label><div className="w-64"><SearchInput value={q} onChange={setQ} placeholder="Search employee…" /></div>
      <div className="ml-auto flex flex-wrap gap-2 text-xs">{Object.entries({ P: 'Present', A: 'Absent', H: 'Half day', L: 'Leave' }).map(([k, l]) => <span key={k} className={clsx('rounded px-2 py-1', CELL[k])}>{k} {l}</span>)}</div>
      {can('hr:manage') && <Button onClick={() => mark.mutate(undefined as never)} loading={mark.isPending}>Mark everyone present today</Button>}</div>
    {isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} onRetry={() => refetch()} /> : (
      <div className="overflow-x-auto rounded-xl border border-line bg-white"><table className="w-full text-xs"><thead className="bg-slate-50"><tr><th className="th sticky left-0 z-10 min-w-[11rem] bg-slate-50">Employee</th>{Array.from({ length: data.days }, (_, i) => <th key={i} className="px-1 py-2 text-center font-medium text-slate-500">{i + 1}</th>)}<th className="th">P</th><th className="th">A</th><th className="th">L</th></tr></thead>
        <tbody className="divide-y divide-line">{data.data.map((e: any) => <tr key={e.id}><td className="sticky left-0 bg-white px-3 py-1.5"><p className="font-medium">{e.full_name}</p><p className="text-slate-500">{e.code}</p></td>
          {Array.from({ length: data.days }, (_, i) => { const d = i + 1; const s = e.cells[d] ?? ''; const future = `${month}-${String(d).padStart(2, '0')}` > today(); return <td key={d} className="p-0.5 text-center"><button disabled={!can('hr:manage') || future} aria-label={`${e.full_name} day ${d}`} className={clsx('h-6 w-6 rounded text-[10px] font-semibold', s ? CELL[s] : 'bg-white text-slate-300 hover:bg-slate-100')} onClick={() => cycle.mutate({ id: e.id, day: d, status: next[s] ?? 'P' })}>{s || '·'}</button></td>; })}
          <td className="td tabular-nums">{e.present}</td><td className="td tabular-nums text-red-600">{e.absent}</td><td className="td tabular-nums text-blue-700">{e.leave}</td></tr>)}</tbody></table></div>)}
    <p className="mt-2 text-xs text-slate-500">Click a day to cycle Present → Absent → Half day. Sundays are weekly offs; leave days come from approved leave requests.</p>
  </>;
}

function LeaveModal({ onClose }: { onClose: () => void }) {
  const emps = useQuery({ queryKey: ['/hr/employees', 'options'], queryFn: () => get('/hr/employees?pageSize=100') });
  const [f, setF] = useState({ employeeId: '', leaveType: 'ANNUAL', fromDate: today(), toDate: today(), reason: '' });
  const m = useAction(() => post('/hr/leave', { ...f, employeeId: Number(f.employeeId), reason: f.reason || undefined }), { invalidate: ['/hr', '/approvals'], success: 'Leave request sent for approval.', onSuccess: onClose }); const fe = fieldErrors(m.error);
  return <Modal open onClose={onClose} title="New leave request" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Submit (F10)</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">{m.error && !m.error.fields && <div className="sm:col-span-2"><Alert tone="danger">{m.error.message}</Alert></div>}
      <SelectInput label="Employee" required wrapperClassName="sm:col-span-2" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} placeholder="Select employee" error={fe.employeeId} options={(emps.data?.data ?? []).map((e: any) => ({ value: e.id, label: `${e.full_name} (${e.code})` }))} />
      <SelectInput label="Leave type" value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })} options={['ANNUAL', 'SICK', 'CASUAL', 'UNPAID'].map((t) => ({ value: t, label: titleCase(t) }))} /><div />
      <TextInput label="From" type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} error={fe.fromDate} /><TextInput label="To" type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} error={fe.toDate} />
      <TextInput label="Reason" wrapperClassName="sm:col-span-2" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div></Modal>;
}
function LeaveTab() {
  const { can } = useAuth(); const { state, set, page } = useQueryState(); const [adding, setAdding] = useState(false);
  const { data, isLoading, error, refetch } = useList('/hr/leave', { page, pageSize: 15, q: state.q, status: state.status });
  const cols: Column<any>[] = [{ key: 'emp', header: 'Employee', render: (l) => <div><p className="font-semibold">{l.full_name}</p><p className="text-xs text-slate-500">{l.code}</p></div> }, { key: 'type', header: 'Type', render: (l) => titleCase(l.leave_type) }, { key: 'dates', header: 'Dates', render: (l) => `${fmtDate(l.from_date)} – ${fmtDate(l.to_date)}` },
    { key: 'days', header: 'Days', render: (l) => Number(l.days) }, { key: 'why', header: 'Reason', hideBelow: 'md', render: (l) => l.reason }, { key: 'st', header: 'Status', render: (l) => <StatusPill status={l.status} /> }];
  return <>
    <FilterBar active={!!state.q || !!state.status} onClear={() => set({ q: undefined, status: undefined })}><SearchInput className="w-full sm:w-64" value={state.q ?? ''} onChange={(v) => set({ q: v })} placeholder="Search employee…" />
      <FilterSelect label="Status" value={state.status ?? 'ALL'} onChange={(v) => set({ status: v })} options={[{ value: 'ALL', label: 'All' }, ...['PENDING', 'APPROVED', 'REJECTED'].map((s) => ({ value: s, label: titleCase(s) }))]} />{can('hr:manage') && <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New leave request</Button>}</FilterBar>
    <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(l) => l.id} page={page} pageSize={15} total={data?.meta.total ?? 0} onPage={(p) => set({ page: p }, false)} empty={{ title: 'No leave requests' }} />
    <p className="mt-2 text-xs text-slate-500">Requests are approved in the Approval Center; approved leave appears on the attendance sheet automatically.</p>
    {adding && <LeaveModal onClose={() => setAdding(false)} />}</>;
}

function PayModal({ run, onClose }: { run: any; onClose: () => void }) {
  const banks = useBanks(); const [mode, setMode] = useState('BANK'); const [bankId, setBankId] = useState('');
  const m = useAction(() => post(`/hr/payroll/${run.id}/pay`, { mode, bankId: bankId ? Number(bankId) : undefined }), { invalidate: ['/hr', '/finance'], success: 'Salaries paid and posted.', onSuccess: onClose });
  return <Modal open onClose={onClose} title={`Pay salaries — ${run.period}`} description={`PKR ${money(run.net)} to ${run.employees ?? ''} employees`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(undefined as never)}>Pay now (F10)</Button></>}>
    <div className="grid gap-4">{m.error && <Alert tone="danger">{m.error.message}</Alert>}<SelectInput label="Paid by" value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: 'BANK', label: 'Bank transfer' }, { value: 'CASH', label: 'Cash' }]} />
      {mode === 'BANK' && <SelectInput label="From bank account" required value={bankId} onChange={(e) => setBankId(e.target.value)} placeholder="Select bank" options={(banks.data?.data ?? []).map((b: any) => ({ value: b.id, label: b.name }))} />}</div></Modal>;
}
function PayrollDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/hr/payroll', id], queryFn: () => get(`/hr/payroll/${id}`) }); const run = data?.run;
  return <Drawer open onClose={onClose} width="max-w-4xl" title={run ? `Payroll ${run.period}` : 'Payroll'} description={run ? `${titleCase(run.status)} · net PKR ${money(run.net)}` : undefined}>
    {isLoading ? <PageLoader /> : error || !run ? <ErrorState error={error} onRetry={() => refetch()} /> : <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Employee</th><th className="th text-right">Basic</th><th className="th text-right">Allowances</th><th className="th text-right">Trips</th><th className="th text-right">Trip bonus</th><th className="th text-right">Absent</th><th className="th text-right">Deduction</th><th className="th text-right">Net</th></tr></thead>
      <tbody className="divide-y divide-line">{data.lines.map((l: any) => <tr key={l.id}><td className="td"><p className="font-medium">{l.full_name}</p><p className="text-xs text-slate-500">{l.code} · {l.department}</p></td><td className="td text-right tabular-nums">{money(l.basic)}</td><td className="td text-right tabular-nums">{money(l.allowances)}</td><td className="td text-right tabular-nums">{l.trips}</td><td className="td text-right tabular-nums">{money(l.trip_bonus)}</td><td className="td text-right tabular-nums">{Number(l.absent_days)}</td><td className="td text-right tabular-nums text-red-600">{money(l.absence_deduction)}</td><td className="td text-right font-semibold tabular-nums">{money(l.net)}</td></tr>)}</tbody>
      <tfoot className="bg-slate-50 font-semibold"><tr><td className="td">Total</td><td colSpan={5} /><td className="td text-right tabular-nums text-red-600">{money(run.deductions)}</td><td className="td text-right tabular-nums">{money(run.net)}</td></tr></tfoot></table></div>}
  </Drawer>;
}
function PayrollTab() {
  const { can } = useAuth(); const [open, setOpen] = useState<number | null>(null); const [pay, setPay] = useState<any>(null); const [period, setPeriod] = useState(today().slice(0, 7));
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['/hr/payroll'], queryFn: () => get('/hr/payroll'), enabled: can('payroll:manage') });
  const build = useAction(() => post('/hr/payroll', { period }), { invalidate: ['/hr'], success: 'Payroll run prepared.' });
  const submit = useAction((id: number) => post(`/hr/payroll/${id}/submit`, {}), { invalidate: ['/hr', '/approvals'], success: 'Sent for approval.' });
  if (!can('payroll:manage')) return <Alert tone="info">Payroll is visible to payroll managers only.</Alert>;
  const cols: Column<any>[] = [{ key: 'p', header: 'Period', render: (r) => <span className="font-semibold text-brand-700">{r.period}</span> }, { key: 'emp', header: 'Employees', render: (r) => r.employees }, { key: 'g', header: 'Gross', render: (r) => <span className="tabular-nums">{money(r.gross)}</span> },
    { key: 'd', header: 'Deductions', hideBelow: 'md', render: (r) => <span className="tabular-nums">{money(r.deductions)}</span> }, { key: 'n', header: 'Net payable', render: (r) => <span className="font-semibold tabular-nums">{money(r.net)}</span> }, { key: 's', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'a', header: '', render: (r) => <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>{r.status === 'DRAFT' && <Button size="sm" variant="primary" loading={submit.isPending && submit.variables === r.id} onClick={() => submit.mutate(r.id)}>Submit for approval</Button>}{r.status === 'POSTED' && <Button size="sm" variant="primary" onClick={() => setPay(r)}>Pay salaries</Button>}</div> }];
  return <>
    <div className="mb-3 flex flex-wrap items-end gap-3"><label className="text-xs font-medium text-slate-600">Prepare run for<input type="month" className="input mt-1" max={today().slice(0, 7)} value={period} onChange={(e) => setPeriod(e.target.value)} /></label><Button variant="primary" loading={build.isPending} onClick={() => build.mutate(undefined as never)}>Prepare / rebuild draft</Button>{build.error && <p className="text-sm text-red-600">{build.error.message}</p>}</div>
    <DataTable columns={cols} rows={data?.data} loading={isLoading} error={error} onRetry={() => refetch()} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)} empty={{ title: 'No payroll runs yet' }} />
    <p className="mt-2 text-xs text-slate-500">Net = basic + allowances + trip bonus − absence deduction (basic ÷ 30 per absent day). Approved runs post to the ledger (salary expense against salaries payable); paying clears the payable.</p>
    {open != null && <PayrollDrawer id={open} onClose={() => setOpen(null)} />}{pay && <PayModal run={pay} onClose={() => setPay(null)} />}
  </>;
}

export default function HR() {
  const { can } = useAuth(); const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'employees';
  const sum = useQuery({ queryKey: ['/hr/summary'], queryFn: () => get('/hr/summary') }); const s = sum.data;
  return <>
    <PageHeader title="HR & Payroll" subtitle="Employees, attendance, leave and monthly payroll — drivers, helpers and office staff in one place" breadcrumbs={[{ label: 'People' }, { label: 'HR & payroll' }]} />
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5"><KpiCard label="Headcount" value={s?.headcount ?? '–'} tone="blue" /><KpiCard label="Present today" value={s?.present_today ?? '–'} tone="green" /><KpiCard label="Absent today" value={s?.absent_today ?? '–'} tone={s?.absent_today ? 'red' : 'slate'} /><KpiCard label="Pending leave" value={s?.pending_leave ?? '–'} tone="amber" to="/approvals" />
      {s?.payroll && <KpiCard label={`Payroll ${s.payroll.period}`} value={`PKR ${money(s.payroll.net)}`} hint={titleCase(s.payroll.status)} tone="purple" />}</div>
    <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'employees', label: 'Employees' }, { key: 'attendance', label: 'Attendance' }, { key: 'leave', label: 'Leave' }, ...(can('payroll:manage') ? [{ key: 'payroll', label: 'Payroll' }] : [])]} />
    <div className="mt-4">{tab === 'employees' && <EmployeesTab />}{tab === 'attendance' && <AttendanceTab />}{tab === 'leave' && <LeaveTab />}{tab === 'payroll' && <PayrollTab />}</div>
  </>;
}
export { KV, KVGrid };
