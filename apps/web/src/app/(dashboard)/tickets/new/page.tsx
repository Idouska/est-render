'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function NewTicketPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    subject: '', customerEmail: '', customerName: '', orderNumber: '',
    priority: 'NORMAL', category: '', message: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Erreur lors de la création.');
      return;
    }

    router.push(`/tickets/${data.id}`);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/tickets" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6">
        <ArrowLeft className="w-4 h-4" /> Retour
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Nouveau ticket</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Sujet *</label>
          <input
            value={form.subject} onChange={set('subject')} required
            placeholder="Ex : Je n'ai pas reçu ma commande"
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email client *</label>
            <input
              type="email" value={form.customerEmail} onChange={set('customerEmail')} required
              placeholder="client@email.com"
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom du client</label>
            <input
              value={form.customerName} onChange={set('customerName')}
              placeholder="Prénom Nom"
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">N° de commande</label>
            <input
              value={form.orderNumber} onChange={set('orderNumber')}
              placeholder="Ex : 1042"
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Priorité</label>
            <select
              value={form.priority} onChange={set('priority')}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            >
              <option value="LOW">Basse</option>
              <option value="NORMAL">Normale</option>
              <option value="HIGH">Haute</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie</label>
          <select
            value={form.category} onChange={set('category')}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          >
            <option value="">— Choisir une catégorie —</option>
            <option value="delivery">Livraison</option>
            <option value="return">Retour / Échange</option>
            <option value="refund">Remboursement</option>
            <option value="product">Problème produit</option>
            <option value="other">Autre</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Message initial *</label>
          <textarea
            value={form.message} onChange={set('message')} required rows={5}
            placeholder="Décrivez le problème du client…"
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm resize-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Créer le ticket
          </button>
          <Link href="/tickets" className="px-6 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
