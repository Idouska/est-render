'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare, LayoutDashboard, Ticket, Users, ShoppingBag,
  Plug, BarChart3, Settings, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
  { href: '/tickets', icon: Ticket, label: 'Tickets' },
  { href: '/customers', icon: Users, label: 'Clients' },
  { href: '/orders', icon: ShoppingBag, label: 'Commandes' },
  { href: '/analytics', icon: BarChart3, label: 'Analytiques' },
  { href: '/integrations', icon: Plug, label: 'Intégrations' },
  { href: '/settings', icon: Settings, label: 'Paramètres' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 flex-shrink-0 bg-slate-900 flex flex-col overflow-y-auto">
      <div className="h-16 flex items-center px-5 border-b border-slate-800">
        <Link href="/dashboard" className="flex items-center gap-2 text-white font-bold text-lg">
          <MessageSquare className="w-6 h-6 text-indigo-400" />
          SupportHub
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'sidebar-link',
                active ? 'sidebar-link-active' : 'sidebar-link-inactive'
              )}
            >
              <Icon className="w-4.5 h-4.5 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4">
        <div className="bg-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Plan Starter</p>
          <div className="w-full bg-slate-700 rounded-full h-1.5 mb-2">
            <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: '34%' }} />
          </div>
          <p className="text-xs text-slate-400">170 / 500 tickets ce mois</p>
          <Link href="/settings" className="mt-3 block text-center text-xs text-indigo-400 hover:text-indigo-300 font-medium">
            Passer au Pro →
          </Link>
        </div>
      </div>
    </aside>
  );
}
