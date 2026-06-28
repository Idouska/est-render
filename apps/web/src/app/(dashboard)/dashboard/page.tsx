import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and, inArray, gte, count } from 'drizzle-orm';
import { formatRelativeTime, STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/utils';
import Link from 'next/link';
import { Ticket, Users, CheckCircle2, TrendingUp, AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tableau de bord' };

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session!.user.tenantId;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    [{ totalOpen }],
    [{ totalResolved }],
    [{ totalCustomers }],
    [{ urgentTickets }],
    [{ todayResolved }],
    recentTickets,
  ] = await Promise.all([
    db.select({ totalOpen: count() }).from(schema.tickets)
      .where(and(eq(schema.tickets.tenantId, tenantId), inArray(schema.tickets.status, ['OPEN', 'IN_PROGRESS']))),
    db.select({ totalResolved: count() }).from(schema.tickets)
      .where(and(eq(schema.tickets.tenantId, tenantId), eq(schema.tickets.status, 'RESOLVED'))),
    db.select({ totalCustomers: count() }).from(schema.customers)
      .where(eq(schema.customers.tenantId, tenantId)),
    db.select({ urgentTickets: count() }).from(schema.tickets)
      .where(and(
        eq(schema.tickets.tenantId, tenantId),
        eq(schema.tickets.priority, 'URGENT'),
        inArray(schema.tickets.status, ['OPEN', 'IN_PROGRESS'])
      )),
    db.select({ todayResolved: count() }).from(schema.tickets)
      .where(and(
        eq(schema.tickets.tenantId, tenantId),
        eq(schema.tickets.status, 'RESOLVED'),
        gte(schema.tickets.resolvedAt, todayStart.toISOString())
      )),
    db.query.tickets.findMany({
      where: (t, { eq: e }) => e(t.tenantId, tenantId),
      with: {
        customer: { columns: { email: true, firstName: true, lastName: true } },
        agent: { columns: { name: true } },
      },
      orderBy: (t, { desc }) => desc(t.createdAt),
      limit: 8,
    }),
  ]);

  const stats = [
    { label: 'Tickets ouverts', value: Number(totalOpen), icon: Ticket, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: "Résolus aujourd'hui", value: Number(todayResolved), icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Clients actifs', value: Number(totalCustomers), icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Total résolu', value: Number(totalResolved), icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bonjour, {session!.user.name.split(' ')[0]} 👋</h1>
        <p className="text-gray-500 text-sm mt-1">Voici l&apos;état de votre SAV en temps réel.</p>
      </div>

      {Number(urgentTickets) > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">
            <strong>{Number(urgentTickets)} ticket{Number(urgentTickets) > 1 ? 's' : ''} urgent{Number(urgentTickets) > 1 ? 's' : ''}</strong>{' '}
            nécessite{Number(urgentTickets) > 1 ? 'nt' : ''} votre attention immédiate.
          </p>
          <Link href="/tickets?priority=URGENT" className="ml-auto text-sm font-medium text-red-600 hover:underline">Voir →</Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center mb-3`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value.toLocaleString('fr-FR')}</p>
            <p className="text-sm text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
          <h2 className="font-semibold text-gray-900">Tickets récents</h2>
          <Link href="/tickets" className="text-sm text-indigo-600 hover:underline">Voir tous →</Link>
        </div>
        <div className="divide-y divide-gray-50">
          {recentTickets.length === 0 && (
            <div className="px-6 py-10 text-center text-gray-400 text-sm">
              Aucun ticket pour l&apos;instant. Connectez votre boutique pour commencer.
            </div>
          )}
          {recentTickets.map((ticket) => (
            <Link key={ticket.id} href={`/tickets/${ticket.id}`}
              className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{ticket.subject}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {ticket.customer.firstName} {ticket.customer.lastName} · {ticket.customer.email}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[ticket.status]}`}>
                  {STATUS_LABELS[ticket.status]}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
                  {PRIORITY_LABELS[ticket.priority]}
                </span>
                <span className="text-xs text-gray-400 hidden md:block w-24 text-right">
                  {formatRelativeTime(ticket.createdAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
