import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Component, ReactNode } from 'react';
import { Layout } from './features/Layout';
import { HomeRedirect, RequireAuth, RequirePerm } from './features/guards';
import { PageLoader, EmptyState } from './ui/Feedback';
import { Button } from './ui/Button';

const Login = lazy(() => import('./pages/Login'));
const ControlTower = lazy(() => import('./pages/ControlTower'));
const Trips = lazy(() => import('./pages/Trips'));
const TripNew = lazy(() => import('./pages/TripNew'));
const TripDetail = lazy(() => import('./pages/TripDetail'));
const Dispatch = lazy(() => import('./pages/Dispatch'));
const Fleet = lazy(() => import('./pages/Fleet'));
const VehicleDetail = lazy(() => import('./pages/VehicleDetail'));
const Drivers = lazy(() => import('./pages/Drivers'));
const DriverDetail = lazy(() => import('./pages/DriverDetail'));
const Tracking = lazy(() => import('./pages/Tracking'));
const Locations = lazy(() => import('./pages/Locations'));
const Distributors = lazy(() => import('./pages/Distributors'));
const DistributorDetail = lazy(() => import('./pages/DistributorDetail'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const Documents = lazy(() => import('./pages/Documents'));
const Safety = lazy(() => import('./pages/Safety'));
const Reports = lazy(() => import('./pages/Reports'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Audit = lazy(() => import('./pages/Audit'));
const Users = lazy(() => import('./pages/Users'));
const DriverHome = lazy(() => import('./pages/DriverHome'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Fuel = lazy(() => import('./pages/Fuel'));
const Approvals = lazy(() => import('./pages/Approvals'));
const RoutesPage = lazy(() => import('./pages/Routes'));
const Settings = lazy(() => import('./pages/Settings'));
const Track = lazy(() => import('./pages/Track'));
const Vouchers = lazy(() => import('./pages/Vouchers'));
const FinanceReports = lazy(() => import('./pages/FinanceReports'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Invoices = lazy(() => import('./pages/Invoices'));
const InvoicePrintBatch = lazy(() => import('./pages/Invoices').then((m) => ({ default: m.InvoicePrintBatch })));
const Customers = lazy(() => import('./pages/Customers'));
const Vendors = lazy(() => import('./pages/Vendors'));
const SetupHub = lazy(() => import('./pages/SetupHub'));
const ManagerHome = lazy(() => import('./pages/ManagerHome'));
const Exceptions = lazy(() => import('./pages/Exceptions'));
const HR = lazy(() => import('./pages/HR'));
const TripVouchers = lazy(() => import('./pages/TripVouchers'));
const TripVoucherPrint = lazy(() => import('./pages/TripVouchers').then((m) => ({ default: m.TripVoucherPrint })));
const Inventory = lazy(() => import('./pages/Inventory'));
const InventoryReports = lazy(() => import('./pages/InventoryReports'));
const Procurement = lazy(() => import('./pages/Procurement'));
const Tyres = lazy(() => import('./pages/Tyres'));

class Boundary extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: unknown) { console.error(e); }
  render() {
    if (!this.state.err) return this.props.children;
    return <EmptyState title="Something went wrong on this page" description="The error has been logged. Reload to continue." action={<Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>} />;
  }
}

const P = (perm: any[], el: ReactNode) => <RequirePerm perm={perm}>{el}</RequirePerm>;

export default function App() {
  return (
    <Boundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/track/:token" element={<Track />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<HomeRedirect>{P(['dashboard:view'], <ControlTower />)}</HomeRedirect>} />
            <Route path="driver" element={<DriverHome />} />
            <Route path="trips" element={P(['trips:view'], <Trips />)} />
            <Route path="trips/new" element={P(['trips:create'], <TripNew />)} />
            <Route path="trips/:id" element={P(['trips:view'], <TripDetail />)} />
            <Route path="trips/:id/voucher" element={P(['trips:view'], <TripVoucherPrint />)} />
            <Route path="trip-vouchers" element={<Navigate to="/trip-vouchers/trip-start" replace />} />
            <Route path="trip-vouchers/:key" element={P(['trips:view'], <TripVouchers />)} />
            <Route path="dispatch" element={P(['trips:assign', 'trips:dispatch'], <Dispatch />)} />
            <Route path="tracking" element={P(['tracking:view'], <Tracking />)} />
            <Route path="fleet" element={P(['vehicles:view'], <Fleet />)} />
            <Route path="fleet/:id" element={P(['vehicles:view'], <VehicleDetail />)} />
            <Route path="drivers" element={P(['drivers:view'], <Drivers />)} />
            <Route path="drivers/:id" element={P(['drivers:view'], <DriverDetail />)} />
            <Route path="locations" element={P(['locations:view'], <Locations />)} />
            <Route path="distributors" element={P(['distributors:view'], <Distributors />)} />
            <Route path="distributors/:id" element={P(['distributors:view'], <DistributorDetail />)} />
            <Route path="maintenance" element={P(['maintenance:view'], <Maintenance />)} />
            <Route path="documents" element={P(['documents:view'], <Documents />)} />
            <Route path="safety" element={P(['safety:view', 'safety:report'], <Safety />)} />
            <Route path="reports" element={P(['reports:view'], <Reports />)} />
            <Route path="notifications" element={P(['notifications:view'], <Notifications />)} />
            <Route path="expenses" element={P(['expenses:view'], <Expenses />)} />
            <Route path="fuel" element={P(['fuel:view'], <Fuel />)} />
            <Route path="approvals" element={P(['approvals:view'], <Approvals />)} />
            <Route path="routes" element={P(['routes:view'], <RoutesPage />)} />
            <Route path="customers" element={P(['sales:view', 'distributors:view'], <Customers />)} />
            <Route path="sales/print" element={P(['sales:view'], <InvoicePrintBatch />)} />
            <Route path="sales/invoices" element={P(['sales:view'], <Invoices />)} />
            <Route path="finance/vouchers" element={P(['finance:view'], <Vouchers />)} />
            <Route path="finance/reports" element={<Navigate to="/finance/reports/daybook" replace />} />
            <Route path="finance/reports/:key" element={P(['finance:view'], <FinanceReports />)} />
            <Route path="finance/accounts" element={P(['finance:view'], <Accounts />)} />
            <Route path="vendors" element={P(['vendors:view'], <Vendors />)} />
            <Route path="inventory" element={P(['inventory:view'], <Inventory />)} />
            <Route path="inventory/reports" element={<Navigate to="/inventory/reports/inventory-summary" replace />} />
            <Route path="inventory/reports/:key" element={P(['inventory:view'], <InventoryReports />)} />
            <Route path="procurement" element={P(['procurement:view'], <Procurement />)} />
            <Route path="tyres" element={P(['tyres:view'], <Tyres />)} />
            <Route path="exceptions" element={P(['exceptions:view'], <Exceptions />)} />
            <Route path="setup" element={P(['settings:view'], <SetupHub />)} />
            <Route path="m" element={P(['dashboard:view'], <ManagerHome />)} />
            <Route path="hr" element={P(['hr:view'], <HR />)} />
            <Route path="settings" element={P(['settings:view'], <Settings />)} />
            <Route path="audit" element={P(['audit:view'], <Audit />)} />
            <Route path="users" element={P(['users:view'], <Users />)} />
            <Route path="*" element={<EmptyState title="Page not found" description="The page you’re looking for doesn’t exist or has moved." action={<Link to="/" className="text-sm font-medium text-brand-700 hover:underline">Go to home</Link>} />} />
          </Route>
        </Routes>
      </Suspense>
    </Boundary>
  );
}
