import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Categorical palette validated for contrast on white and distinguishable status semantics.
export const COLORS = { blue: '#2563eb', green: '#16a34a', amber: '#d97706', red: '#dc2626', purple: '#7c3aed', slate: '#94a3b8', teal: '#0d9488' };
const AX = { fontSize: 11, fill: '#64748b' };

export function TripsBarChart({ data }: { data: { label: string; completed: number; delayed: number; cancelled: number }[] }) {
  const rows = data.map((d) => ({ ...d, onTime: Math.max(0, d.completed - d.delayed) }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={rows} margin={{ left: -18, right: 4, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={AX} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={AX} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="onTime" name="Completed on time" stackId="a" fill={COLORS.blue} />
        <Bar dataKey="delayed" name="Completed late" stackId="a" fill={COLORS.amber} />
        <Bar dataKey="cancelled" name="Cancelled" stackId="a" fill={COLORS.slate} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LpgLineChart({ data }: { data: { label: string; lpg_mt: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={AX} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={AX} tickLine={false} axisLine={false} unit=" MT" />
        <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(1)} MT`, 'LPG delivered']} />
        <Line type="monotone" dataKey="lpg_mt" stroke={COLORS.blue} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, colors }: { data: { name: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={210}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={84} paddingAngle={2} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold tabular-nums">{total}</span><span className="text-xs text-slate-500">vehicles</span></div>
    </div>
  );
}

export function HBarChart({ data, unit = 'MT', color = COLORS.blue }: { data: { name: string; mt: number }[]; unit?: string; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
        <XAxis type="number" tick={AX} tickLine={false} axisLine={false} unit={` ${unit}`} />
        <YAxis type="category" dataKey="name" tick={AX} tickLine={false} axisLine={false} width={120} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(1)} ${unit}`, 'Delivered']} />
        <Bar dataKey="mt" fill={color} radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}
