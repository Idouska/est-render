import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and, or, like, count, desc, inArray } from 'drizzle-orm';
import { formatDateShort, formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Commandes' };

interface PageProps {
  searchParams: { platform?: string; q?: string; page?: string };
}

export default async function OrdersPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const tenantId = session!.user.tenantId;
  const { platform, q, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? '1'));
  const perPage = 25;

  let searchCustomerIds: string[] = [];
  if (q) {
    const matching = await db.select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(
        eq(schema.customers.tenantId, tenantId),
        like(schema.customers.email, `%${q}%`)
      ));
    searchCustomerIds = matching.map((c) => c.id);
  }

  const buildWhere = () => and(
    eq(schema.orders.tenantId, tenantId),
    platform ? eq(schema.orders.platform, platform) : undefined,
    q
      ? (searchCustomerIds.length > 0
        ? or(like(schema.orders.orderNumber, `%${q}%`), inArray(schema.orders.customerId, searchCustomerIds))
        : like(schema.orders.orderNumber, `%${q}%`))
      : undefined,
  );

  const [[{ total }], orders] = await Promise.all([
    db.select({ total: count() }).from(schema.orders).where(buildWhere()),
    db.query.orders.findMany({
      where: buildWhere(),
      with: {
        customer: { columns: { email: true, firstName: true, lastName: true } },
        items: { columns: { id: true } },
      },
      orderBy: [desc(schema.orders.createdAt)],
      limit: perPage,
      offset: (page - 1) * perPage,
    }),
  ]);

  const STATUS_COLOR: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    fulfilled: 'bg-blue-100 text-blue-700',
    pending: 'bg-yellow-100 text-yellow-700',
    refunded: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-600',
    processing: 'bg-indigo-100 text-indigo-700',
    completed: 'bg-green-100 text-green-700',
    on_hold: 'bg-orange-100 text-orange-700',
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commandes</h1>
          <p className="text-sm text-gray-500 mt-0.5">{Number(total).toLocaleString('fr-FR')} commande{Number(total) !== 1 ? 's' : ''} synchronisées</p>
        </div>
        <div className="flex gap-2">
          {['', 'shopify', 'woocommerce'].map((p) => (
            <Link
              key={p || 'all'}
              href={`/orders${p ? `?platform=${p}` : ''}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                platform === p || (!platform && !p)
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p === '' ? 'Toutes' : p.charAt(0).toUpperCase() + p.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <form method="GET">
          <input
            name="q"
            defaultValue={q}
            placeholder="Rechercher par numéro ou email client…"
            className="w-full max-w-sm border border-gray-200 rounded-lg px-4 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Commande</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Client</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Statut</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Plateforme</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Total</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                  Aucune commande. Connectez une boutique dans{' '}
                  <Link href="/integrations" className="text-indigo-600 hover:underline">Intégrations</Link>.
                </td>
              </tr>
            )}
            {orders.map((order) => {
              const name = [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' ') || order.customer.email;
              return (
                <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-gray-900">#{order.orderNumber}</p>
                    <p className="text-xs text-gray-400">{order.items.length} article{order.items.length !== 1 ? 's' : ''}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <Link href={`/customers/${order.customerId}`} className="hover:text-indigo-600 text-gray-700">{name}</Link>
                    <p className="text-xs text-gray-400">{order.customer.email}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLOR[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <span className={`text-xs font-medium capitalize ${order.platform === 'shopify' ? 'text-green-700' : 'text-purple-700'}`}>
                      {order.platform}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right font-medium text-gray-900">
                    {formatCurrency(order.total, order.currency)}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-400 text-right hidden lg:table-cell">
                    {formatDateShort(order.createdAt)}
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
