import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { formatDate, formatCurrency, STATUS_LABELS, PRIORITY_LABELS, STATUS_COLORS, PRIORITY_COLORS } from '@/lib/utils';
import { TicketActions } from '@/components/tickets/ticket-actions';
import { MessageThread } from '@/components/tickets/message-thread';
import { ReplyBox } from '@/components/tickets/reply-box';
import Link from 'next/link';
import { ArrowLeft, ShoppingBag, User } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Ticket' };

interface PageProps { params: { id: string } }

export default async function TicketDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  const tenantId = session!.user.tenantId;

  const ticket = await db.query.tickets.findFirst({
    where: (t, { and: a, eq: e }) => a(e(t.id, id), e(t.tenantId, tenantId)),
    with: {
      customer: true,
      order: { with: { items: true } },
      agent: { columns: { id: true, name: true, email: true } },
      messages: {
        with: { author: { columns: { name: true } } },
        orderBy: (m, { asc: a }) => a(m.createdAt),
      },
    },
  });

  if (!ticket) notFound();

  const [agents, cannedResponses, customerOrders] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.tenantId, tenantId))
      .orderBy(asc(schema.users.name)),
    db.select({ id: schema.cannedResponses.id, title: schema.cannedResponses.title, content: schema.cannedResponses.content })
      .from(schema.cannedResponses)
      .where(eq(schema.cannedResponses.tenantId, tenantId))
      .orderBy(asc(schema.cannedResponses.title)),
    db.select({
      id: schema.orders.id,
      orderNumber: schema.orders.orderNumber,
      status: schema.orders.status,
      total: schema.orders.total,
      currency: schema.orders.currency,
      createdAt: schema.orders.createdAt,
    })
      .from(schema.orders)
      .where(eq(schema.orders.customerId, ticket.customerId))
      .orderBy(desc(schema.orders.createdAt))
      .limit(5),
  ]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-5">
        <Link href="/tickets" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" /> Retour aux tickets
        </Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-bold text-gray-900">{ticket.subject}</h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[ticket.status]}`}>
              {STATUS_LABELS[ticket.status]}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
              {PRIORITY_LABELS[ticket.priority]}
            </span>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1">#{ticket.id.slice(-8)} · Créé le {formatDate(ticket.createdAt)}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <MessageThread messages={ticket.messages} />
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <ReplyBox
              ticketId={ticket.id}
              agentId={session!.user.id}
              cannedResponses={cannedResponses}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-800 text-sm mb-4">Actions</h3>
            <TicketActions
              ticket={{ id: ticket.id, status: ticket.status, priority: ticket.priority, agentId: ticket.agentId ?? undefined }}
              agents={agents}
            />
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-800 text-sm mb-4 flex items-center gap-2">
              <User className="w-4 h-4" /> Client
            </h3>
            <div className="space-y-2 text-sm">
              <p className="font-medium text-gray-900">
                {ticket.customer.firstName} {ticket.customer.lastName}
              </p>
              <a href={`mailto:${ticket.customer.email}`} className="text-indigo-600 hover:underline block">
                {ticket.customer.email}
              </a>
              {ticket.customer.phone && (
                <p className="text-gray-500">{ticket.customer.phone}</p>
              )}
              <Link href={`/customers/${ticket.customerId}`} className="text-xs text-gray-400 hover:text-indigo-600 mt-2 block">
                Voir le profil complet →
              </Link>
            </div>
          </div>

          {ticket.order && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-800 text-sm mb-4 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4" /> Commande liée
              </h3>
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Numéro</span>
                  <span className="font-medium">#{ticket.order.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Statut</span>
                  <span>{ticket.order.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total</span>
                  <span className="font-medium">{formatCurrency(ticket.order.total, ticket.order.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Plateforme</span>
                  <span className="capitalize">{ticket.order.platform}</span>
                </div>
                {ticket.order.items.length > 0 && (
                  <div className="pt-3 border-t border-gray-50">
                    <p className="text-xs font-medium text-gray-500 mb-2">Articles</p>
                    {ticket.order.items.map((item) => (
                      <div key={item.id} className="flex justify-between text-xs py-1">
                        <span className="text-gray-700">{item.quantity}× {item.name}</span>
                        <span>{formatCurrency(item.price * item.quantity)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {customerOrders.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-800 text-sm mb-4">Commandes récentes</h3>
              <div className="space-y-2">
                {customerOrders.map((o) => (
                  <div key={o.id} className="flex justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-gray-600">#{o.orderNumber}</span>
                    <span className="text-gray-400">{o.status}</span>
                    <span className="font-medium">{formatCurrency(o.total, o.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
