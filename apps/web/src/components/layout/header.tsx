'use client';

import { signOut } from 'next-auth/react';
import { Bell, LogOut, Plus } from 'lucide-react';
import Link from 'next/link';
import { getInitials } from '@/lib/utils';

interface HeaderProps {
  user: { name: string; email: string; tenantName: string };
}

export function Header({ user }: HeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 flex-shrink-0">
      <div className="text-sm text-gray-500">
        Espace <span className="font-semibold text-gray-800">{user.tenantName}</span>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/tickets/new"
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nouveau ticket
        </Link>

        <button className="relative p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        <div className="flex items-center gap-2 pl-3 border-l border-gray-100">
          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
            {getInitials(user.name)}
          </div>
          <div className="hidden md:block text-sm">
            <p className="font-medium text-gray-800 leading-tight">{user.name}</p>
            <p className="text-gray-400 text-xs">{user.email}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
            title="Déconnexion"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
