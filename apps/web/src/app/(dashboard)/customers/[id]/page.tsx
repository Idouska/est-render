import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { notFound } from 'next/navigation';
import { formatDate, formatDateShort, formatCurrency, getInitials, STATUS_LABELS, STATUS_COLORS } from '@/lib/utils';
import Link from 'next/link';
import { ArrowLeft, Mail, Phone, ShoppingBag, Ticket } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Profil client' };

interface PageProps { params: { id: string } }

export default async function CustomerDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  const tenantId = session!.user.tenantId;

  const customer = await db.query.customers.findFirst({
    where: (c, { and: a, eq: e }) => a(e(c.id, id), e(c.tenantId, tenantId)),
    with: {
      orders: {
        with: { items: true },
        orderBy: (o, { desc: d }) => d(o.createdAt),
      },
      tickets: {
        with: { agent: { columns: { name: true } } },
        orderBy: (t, { desc: d }) => d(t.createdAt),
      },
    },
  });

  if (!customer) notFound();

  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email;
  const totalSpent = customer.orders.reduce((s, o) => s + o.total, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <Link href="/customers" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
          <ArrowLeft className="w-4 h-4" /> Retour aux clients
        </Link>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-700 font-bold text-xl">
            {getInitials(name)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{name}</h1>
            <p className="text-sm text-gray-500">Client depuis le {formatDateShort(customer.createdAt)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{customer.orders.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Commandes</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSpent)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total dépensé</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{customer.tickets.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Tickets SAV</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
          <h2 className="font-semibold text-gray-800">Coordonnées</h2>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Mail className="w-4 h-4 text-gray-400" />
            <a href={`mailto:${customer.email}`} className="text-indigo-600 hover:underline">{customer.email}</a>
          </div>
          {customer.phone && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Phone className="w-4 h-4 text-gray-400" />
              {customer.phone}
            </div>
          )}
          {customer.platform && (
            <p className="text-xs text-gray-400 capitalize pt-1">
              Plateforme : <strong>{customer.platform}</strong>
              {customer.externalId && ` (ID: ${customer.externalId})`}
            </p>
          )}
          <Link
            href={`/tickets/new?email=${customer.email}&name=${encodeURIComponent(name)}`}
            className="block text-center mt-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            Créer un ticket
          </Link>
        </div>

        <div className="md:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-gray-400" />
            <h2 className="font-semibold text-gray-800">Commandes</h2>
          </div>
          {customer.orders.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Aucune commande synchronisée.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {customer.orders.map((order) => (
                <div key={order.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-gray-900">#{order.orderNumber}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 capitalize">{order.status}</span>
                      <span className="font-medium text-sm">{formatCurrency(order.total, order.currency)}</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 space-y-0.5">
                    {order.items.map((item) => (
                      <p key={item.id}>{item.quantity}× {item.name}</p>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{formatDateShort(order.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
          <Ticket className="w-4 h-4 text-gray-400" />
          <h2 className="font-semibold text-gray-800">Historique SAV</h2>
        </div>
        {customer.tickets.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Aucun ticket pour ce client.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {customer.tickets.map((ticket) => (
              <Link key={ticket.id} href={`/tickets/${ticket.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{ticket.subject}</p>
                  <p className="text-xs text-gray-400">{ticket.agent?.name ?? 'Non assigné'} · {formatDate(ticket.createdAt)}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[ticket.status]}`}>
                  {STATUS_LABELS[ticket.status]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
