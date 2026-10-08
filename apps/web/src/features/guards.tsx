import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '@gasman/shared';
import { useAuth } from '../lib/auth';
import { PageLoader } from '../ui/Feedback';
import { EmptyState } from '../ui/Feedback';
import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth(); const loc = useLocation();
  if (loading) return <PageLoader label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  return <>{children}</>;
}

export function RequirePerm({ perm, children }: { perm: Permission[]; children: React.ReactNode }) {
  const { can } = useAuth();
  if (can(...perm)) return <>{children}</>;
  return <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="You don’t have access to this page" description="Your role does not include this module. Ask an administrator if you need access." action={<Link to="/" className="text-sm font-medium text-brand-700 hover:underline">Back to home</Link>} />;
}

export function HomeRedirect({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role === 'DRIVER') return <Navigate to="/driver" replace />;
  return <>{children}</>;
}
