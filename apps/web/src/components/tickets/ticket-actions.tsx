'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

interface Props {
  ticket: { id: string; status: string; priority: string; agentId?: string };
  agents: { id: string; name: string }[];
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'];
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Ouvert', IN_PROGRESS: 'En cours', WAITING: 'En attente',
  RESOLVED: 'Résolu', CLOSED: 'Fermé',
};
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', URGENT: 'Urgent',
};

export function TicketActions({ ticket, agents }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function update(patch: Record<string, string>) {
    setSaving(true);
    await fetch(`/api/tickets/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {saving && (
        <div className="flex items-center gap-2 text-xs text-indigo-600">
          <Loader2 className="w-3 h-3 animate-spin" /> Sauvegarde…
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Statut</label>
        <select
          defaultValue={ticket.status}
          onChange={(e) => update({ status: e.target.value })}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Priorité</label>
        <select
          defaultValue={ticket.priority}
          onChange={(e) => update({ priority: e.target.value })}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Agent assigné</label>
        <select
          defaultValue={ticket.agentId ?? ''}
          onChange={(e) => update({ agentId: e.target.value || '' })}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
        >
          <option value="">— Non assigné —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
