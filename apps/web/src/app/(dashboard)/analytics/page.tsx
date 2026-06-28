import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and, inArray, count, desc, gte, isNotNull } from 'drizzle-orm';
import { TrendingUp, Clock, CheckCircle2, Star } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Analytiques' };

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session!.user.tenantId;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);

  const [
    [{ totalTickets }],
    [{ openTickets }],
    [{ resolvedTickets }],
    [{ closedTickets }],
    [{ ticketsThisMonth }],
    [{ ticketsThisWeek }],
    [{ urgentOpen }],
    byStatus,
    byPriority,
    byCategory,
    resolvedWithTime,
  ] = await Promise.all([
    db.select({ totalTickets: count() }).from(schema.tickets)
      .where(eq(schema.tickets.tenantId, tenantId)),
    db.select({ openTickets: count() }).from(schema.tickets)
      .where(and(eq(schema.tickets.tenantId, tenantId), inArray(schema.tickets.status, ['OPEN', 'IN_PROGRESS']))),
    db.select({ resolvedTickets: count() }).from(schema.tickets)
      .where(and(eq(schema.tickets.tenantId, tenantId), eq(schema.tickets.status, 'RESOLVED'))),
    db.select({ closedTickets: count() }).from(schema.tickets)
      .where(and(eq(schema.tickets.tenantId, tenantId), eq(schema.tickets.status, 'CLOSED'))),
    db.select({ ticketsThisMonth: count() }).from(schema.tickets)
      .where(and(eq(schema.tickets.tenantId, tenantId), gte(schema.tickets.createdAt, startOfMonth.toISOString()))),
    db.select({ ticketsThisWeek: count() }).from(schema.tickets)
      .where(and(eq(schema.tickets.tenantId, tenantId), gte(schema.tickets.createdAt, startOfWeek.toISOString()))),
    db.select({ urgentOpen: count() }).from(schema.tickets)
      .where(and(
        eq(schema.tickets.tenantId, tenantId),
        eq(schema.tickets.priority, 'URGENT'),
        inArray(schema.tickets.status, ['OPEN', 'IN_PROGRESS'])
      )),
    db.select({ status: schema.tickets.status, cnt: count() })
      .from(schema.tickets)
      .where(eq(schema.tickets.tenantId, tenantId))
      .groupBy(schema.tickets.status),
    db.select({ priority: schema.tickets.priority, cnt: count() })
      .from(schema.tickets)
      .where(eq(schema.tickets.tenantId, tenantId))
      .groupBy(schema.tickets.priority),
    db.select({ category: schema.tickets.category, cnt: count() })
      .from(schema.tickets)
      .where(and(eq(schema.tickets.tenantId, tenantId), isNotNull(schema.tickets.category)))
      .groupBy(schema.tickets.category),
    db.select({ createdAt: schema.tickets.createdAt, resolvedAt: schema.tickets.resolvedAt })
      .from(schema.tickets)
      .where(and(
        eq(schema.tickets.tenantId, tenantId),
        eq(schema.tickets.status, 'RESOLVED'),
        isNotNull(schema.tickets.resolvedAt)
      ))
      .orderBy(desc(schema.tickets.resolvedAt))
      .limit(100),
  ]);

  const total = Number(totalTickets);
  const resolutionRate = total > 0
    ? Math.round(((Number(resolvedTickets) + Number(closedTickets)) / total) * 100)
    : 0;

  const avgResolutionHours = resolvedWithTime.length > 0
    ? Math.round(
        resolvedWithTime
          .filter((t) => t.resolvedAt)
          .reduce((acc, t) => acc + (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()), 0) /
          resolvedWithTime.length /
          3600000
      )
    : null;

  const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Ouvert', IN_PROGRESS: 'En cours', WAITING: 'En attente', RESOLVED: 'Résolu', CLOSED: 'Fermé',
  };
  const PRIORITY_LABELS: Record<string, string> = {
    LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', URGENT: 'Urgent',
  };
  const CATEGORY_LABELS: Record<string, string> = {
    delivery: 'Livraison', return: 'Retour', refund: 'Remboursement',
    product: 'Produit', other: 'Autre',
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytiques</h1>
        <p className="text-sm text-gray-500 mt-1">Performance de votre service client.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Taux de résolution', value: `${resolutionRate}%`, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Temps moyen (h)', value: avgResolutionHours != null ? `${avgResolutionHours}h` : 'N/A', icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Ce mois-ci', value: Number(ticketsThisMonth), icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Urgents ouverts', value: Number(urgentOpen), icon: Star, color: 'text-red-500', bg: 'bg-red-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center mb-3`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Par statut</h3>
          <div className="space-y-2.5">
            {byStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{STATUS_LABELS[s.status] ?? s.status}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-2 bg-indigo-500 rounded-full"
                      style={{ width: `${total > 0 ? Math.round((Number(s.cnt) / total) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="font-medium text-gray-900 w-6 text-right">{Number(s.cnt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Par priorité</h3>
          <div className="space-y-2.5">
            {byPriority.map((p) => (
              <div key={p.priority} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{PRIORITY_LABELS[p.priority] ?? p.priority}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-2 bg-amber-500 rounded-full"
                      style={{ width: `${total > 0 ? Math.round((Number(p.cnt) / total) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="font-medium text-gray-900 w-6 text-right">{Number(p.cnt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Par catégorie</h3>
          {byCategory.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune catégorie assignée.</p>
          ) : (
            <div className="space-y-2.5">
              {byCategory.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{CATEGORY_LABELS[c.category ?? ''] ?? c.category}</span>
                  <span className="font-medium text-gray-900">{Number(c.cnt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-xl p-6 text-white">
        <h3 className="font-semibold text-lg mb-4">Résumé global</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: 'Total tickets', value: total },
            { label: 'Ouverts', value: Number(openTickets) },
            { label: 'Cette semaine', value: Number(ticketsThisWeek) },
            { label: 'Résolus', value: Number(resolvedTickets) + Number(closedTickets) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-3xl font-bold">{value}</p>
              <p className="text-indigo-200 text-sm mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
