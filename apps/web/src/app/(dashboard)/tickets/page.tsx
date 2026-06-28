import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and, or, like, inArray, count, desc } from 'drizzle-orm';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { formatRelativeTime, STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tickets' };

const ALL_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'];

interface PageProps {
  searchParams: { status?: string; priority?: string; q?: string; page?: string };
}

export default async function TicketsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const tenantId = session!.user.tenantId;

  const { status, priority, q, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? '1'));
  const perPage = 20;

  let searchCustomerIds: string[] = [];
  if (q) {
    const matching = await db.select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(
        eq(schema.customers.tenantId, tenantId),
        or(
          like(schema.customers.email, `%${q}%`),
          like(schema.customers.firstName, `%${q}%`),
          like(schema.customers.lastName, `%${q}%`)
        )
      ));
    searchCustomerIds = matching.map((c) => c.id);
  }

  const buildWhere = () => and(
    eq(schema.tickets.tenantId, tenantId),
    status ? eq(schema.tickets.status, status) : undefined,
    priority ? eq(schema.tickets.priority, priority) : undefined,
    q
      ? (searchCustomerIds.length > 0
        ? or(like(schema.tickets.subject, `%${q}%`), inArray(schema.tickets.customerId, searchCustomerIds))
        : like(schema.tickets.subject, `%${q}%`))
      : undefined,
  );

  const [[{ total }], tickets] = await Promise.all([
    db.select({ total: count() }).from(schema.tickets).where(buildWhere()),
    db.query.tickets.findMany({
      where: buildWhere(),
      with: {
        customer: { columns: { email: true, firstName: true, lastName: true } },
        agent: { columns: { name: true } },
        order: { columns: { orderNumber: true } },
      },
      orderBy: [desc(schema.tickets.createdAt)],
      limit: perPage,
      offset: (page - 1) * perPage,
    }),
  ]);

  const totalPages = Math.ceil(Number(total) / perPage);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tickets</h1>
          <p className="text-sm text-gray-500 mt-0.5">{Number(total).toLocaleString('fr-FR')} ticket{Number(total) !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/tickets/new"
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nouveau ticket
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap gap-3">
        <form method="GET" className="flex-1 min-w-48 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Rechercher un ticket, client…"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </form>

        <div className="flex gap-2 flex-wrap">
          {['', ...ALL_STATUSES].map((s) => (
            <Link
              key={s || 'all'}
              href={`/tickets?${new URLSearchParams({ ...(s && { status: s }), ...(priority && { priority }), ...(q && { q }) })}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                status === s || (!status && !s)
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s ? STATUS_LABELS[s] : 'Tous'}
            </Link>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Ticket</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Client</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Statut</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Priorité</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Agent</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {tickets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                  Aucun ticket trouvé.{' '}
                  <Link href="/tickets/new" className="text-indigo-600 hover:underline">Créer le premier</Link>
                </td>
              </tr>
            )}
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3.5">
                  <Link href={`/tickets/${ticket.id}`} className="hover:text-indigo-600 font-medium text-gray-900 block truncate max-w-xs">
                    {ticket.subject}
                  </Link>
                  {ticket.order && (
                    <span className="text-xs text-gray-400">Commande #{ticket.order.orderNumber}</span>
                  )}
                </td>
                <td className="px-4 py-3.5 hidden md:table-cell">
                  <p className="text-gray-700">{ticket.customer.firstName} {ticket.customer.lastName}</p>
                  <p className="text-xs text-gray-400">{ticket.customer.email}</p>
                </td>
                <td className="px-4 py-3.5">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[ticket.status]}`}>
                    {STATUS_LABELS[ticket.status]}
                  </span>
                </td>
                <td className="px-4 py-3.5 hidden lg:table-cell">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
                    {PRIORITY_LABELS[ticket.priority]}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-sm text-gray-500 hidden lg:table-cell">
                  {ticket.agent?.name ?? <span className="text-gray-300 italic">Non assigné</span>}
                </td>
                <td className="px-5 py-3.5 text-xs text-gray-400 text-right whitespace-nowrap">
                  {formatRelativeTime(ticket.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100">
            <p className="text-xs text-gray-400">Page {page} sur {totalPages}</p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/tickets?page=${page - 1}${status ? `&status=${status}` : ''}${q ? `&q=${q}` : ''}`}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-gray-50">
                  ← Précédent
                </Link>
              )}
              {page < totalPages && (
                <Link href={`/tickets?page=${page + 1}${status ? `&status=${status}` : ''}${q ? `&q=${q}` : ''}`}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs hover:bg-gray-50">
                  Suivant →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
