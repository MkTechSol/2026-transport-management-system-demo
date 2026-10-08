import type { Permission } from '@gasman/shared';
import { Activity, AlertTriangle, BarChart3, Bell, Building2, ClipboardCheck, ClipboardList, Fuel as FuelIcon, FileText, Gauge, LayoutGrid, MapPin, Receipt, Settings as SettingsIcon, Shield, ShieldCheck, Store, Truck, Users, UserCog, Wrench, Route as RouteIcon, UserRound, Waypoints, BookOpen, Landmark, Banknote, FileSpreadsheet, Handshake, UsersRound, Siren, Smartphone, Wrench as WrenchIcon, Boxes, ShoppingCart, CircleDot, PackageSearch } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem { to: string; label: string; icon: LucideIcon; perm?: Permission[]; roles?: string[]; end?: boolean; hideFor?: string[] }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { title: 'Operations', items: [
    { to: '/driver', label: 'My Trips', icon: ClipboardList, roles: ['DRIVER'] },
    { to: '/', label: 'Control Tower', icon: LayoutGrid, perm: ['dashboard:view'], end: true },
    { to: '/m', label: 'Manager Mobile', icon: Smartphone, perm: ['approvals:decide'], hideFor: ['DRIVER'] },
    { to: '/trips', label: 'Trips', icon: RouteIcon, perm: ['trips:view'], hideFor: ['DRIVER'] },
    { to: '/trip-vouchers', label: 'Trip Vouchers', icon: ClipboardList, perm: ['trips:view'], hideFor: ['DRIVER'] },
    { to: '/dispatch', label: 'Dispatch Board', icon: Gauge, perm: ['trips:assign', 'trips:dispatch'] },
    { to: '/tracking', label: 'Live Tracking', icon: Activity, perm: ['tracking:view'] },
  ] },
  { title: 'Resources', items: [
    { to: '/fleet', label: 'Fleet', icon: Truck, perm: ['vehicles:view'], hideFor: ['DRIVER'] },
    { to: '/drivers', label: 'Drivers', icon: UserRound, perm: ['drivers:view'], hideFor: ['DRIVER'] },
    { to: '/locations', label: 'Plants & Locations', icon: Building2, perm: ['locations:view'] },
    { to: '/routes', label: 'Routes & Freight', icon: Waypoints, perm: ['routes:view'], hideFor: ['DRIVER'] },
    { to: '/customers', label: 'Customers', icon: Store, perm: ['sales:view', 'distributors:view'] },
    { to: '/vendors', label: 'Vendors', icon: Handshake, perm: ['vendors:view'] },
  ] },
  { title: 'Fuel & Expenses', items: [
    { to: '/fuel', label: 'Fuel', icon: FuelIcon, perm: ['fuel:view'], hideFor: ['DRIVER'] },
    { to: '/expenses', label: 'Trip Expenses', icon: Receipt, perm: ['expenses:view'], hideFor: ['DRIVER'] },
    { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, perm: ['approvals:view'] },
  ] },
  { title: 'Sales & Finance', items: [
    { to: '/sales/invoices', label: 'Invoices & Orders', icon: FileSpreadsheet, perm: ['sales:view'] },
    { to: '/finance/vouchers', label: 'Vouchers', icon: Banknote, perm: ['finance:view'] },
    { to: '/finance/reports', label: 'Financial Reports', icon: BookOpen, perm: ['finance:view'] },
    { to: '/finance/accounts', label: 'Accounts & Banks', icon: Landmark, perm: ['finance:view'] },
  ] },
  { title: 'Inventory', items: [
    { to: '/inventory', label: 'Items & Stock', icon: Boxes, perm: ['inventory:view'] },
    { to: '/procurement', label: 'Procurement', icon: ShoppingCart, perm: ['procurement:view'] },
    { to: '/tyres', label: 'Tyres', icon: CircleDot, perm: ['tyres:view'] },
    { to: '/inventory/reports', label: 'Inventory Reports', icon: PackageSearch, perm: ['inventory:view'] },
  ] },
  { title: 'People', items: [
    { to: '/hr', label: 'HR & Payroll', icon: UsersRound, perm: ['hr:view'] },
  ] },
  { title: 'Compliance & Safety', items: [
    { to: '/maintenance', label: 'Maintenance', icon: Wrench, perm: ['maintenance:view'] },
    { to: '/documents', label: 'Documents', icon: FileText, perm: ['documents:view'], hideFor: ['DRIVER'] },
    { to: '/safety', label: 'Safety', icon: ShieldCheck, perm: ['safety:view'] },
  ] },
  { title: 'Insights', items: [
    { to: '/exceptions', label: 'Exceptions', icon: Siren, perm: ['exceptions:view'] },
    { to: '/reports', label: 'Reports', icon: BarChart3, perm: ['reports:view'] },
    { to: '/notifications', label: 'Notifications', icon: Bell, perm: ['notifications:view'] },
  ] },
  { title: 'Administration', items: [
    { to: '/audit', label: 'Audit Log', icon: Shield, perm: ['audit:view'] },
    { to: '/users', label: 'Users & Roles', icon: UserCog, perm: ['users:view'] },
    { to: '/setup', label: 'Setup', icon: WrenchIcon, perm: ['settings:view'] },
    { to: '/settings', label: 'Settings', icon: SettingsIcon, perm: ['settings:view'] },
  ] },
];
export const _unused = { AlertTriangle, MapPin, Users };
