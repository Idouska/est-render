import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and, or, like, count, desc, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { formatDateShort, getInitials } from '@/lib/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Clients' };

interface PageProps {
  searchParams: { q?: string; page?: string };
}

export default async function CustomersPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const tenantId = session!.user.tenantId;
  const { q, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? '1'));
  const perPage = 25;

  const whereClause = and(
    eq(schema.customers.tenantId, tenantId),
    q ? or(
      like(schema.customers.email, `%${q}%`),
      like(schema.customers.firstName, `%${q}%`),
      like(schema.customers.lastName, `%${q}%`)
    ) : undefined,
  );

  const [[{ total }], customers] = await Promise.all([
    db.select({ total: count() }).from(schema.customers).where(whereClause),
    db.select().from(schema.customers).where(whereClause)
      .orderBy(desc(schema.customers.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
  ]);

  const customerIds = customers.map((c) => c.id);
  const [ticketCounts, orderCounts] = customerIds.length > 0
    ? await Promise.all([
        db.select({ customerId: schema.tickets.customerId, cnt: count() })
          .from(schema.tickets)
          .where(inArray(schema.tickets.customerId, customerIds))
          .groupBy(schema.tickets.customerId),
        db.select({ customerId: schema.orders.customerId, cnt: count() })
          .from(schema.orders)
          .where(inArray(schema.orders.customerId, customerIds))
          .groupBy(schema.orders.customerId),
      ])
    : [[], []] as [{ customerId: string; cnt: number }[], { customerId: string; cnt: number }[]];

  const ticketCountMap = Object.fromEntries(ticketCounts.map((t) => [t.customerId, Number(t.cnt)]));
  const orderCountMap = Object.fromEntries(orderCounts.map((o) => [o.customerId, Number(o.cnt)]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{Number(total).toLocaleString('fr-FR')} client{Number(total) !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <form method="GET">
          <input
            name="q"
            defaultValue={q}
            placeholder="Rechercher par email, nom…"
            className="w-full max-w-sm border border-gray-200 rounded-lg px-4 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Client</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Email</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Tickets</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Commandes</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Inscrit le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-gray-400">
                  Aucun client trouvé. Connectez une boutique pour synchroniser vos clients.
                </td>
              </tr>
            )}
            {customers.map((c) => {
              const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
              return (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <Link href={`/customers/${c.id}`} className="flex items-center gap-3 hover:text-indigo-600">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
                        {getInitials(name === '—' ? c.email : name)}
                      </div>
                      <span className="font-medium text-gray-900">{name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 text-gray-500 hidden md:table-cell">{c.email}</td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="text-xs bg-blue-50 text-blue-700 font-medium px-2 py-0.5 rounded-full">
                      {ticketCountMap[c.id] ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="text-xs bg-green-50 text-green-700 font-medium px-2 py-0.5 rounded-full">
                      {orderCountMap[c.id] ?? 0}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-400 text-right hidden lg:table-cell">
                    {formatDateShort(c.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
