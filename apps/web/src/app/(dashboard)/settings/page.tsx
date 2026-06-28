'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';

interface CannedResponse {
  id: string;
  title: string;
  content: string;
  category?: string;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'general' | 'canned'>('general');
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [newCanned, setNewCanned] = useState({ title: '', content: '', category: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (tab === 'canned') {
      fetch('/api/canned-responses').then((r) => r.json()).then(setCanned);
    }
  }, [tab]);

  async function addCanned() {
    if (!newCanned.title.trim() || !newCanned.content.trim()) return;
    setSaving(true);
    const res = await fetch('/api/canned-responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCanned),
    });
    const item = await res.json();
    setCanned((prev) => [...prev, item]);
    setNewCanned({ title: '', content: '', category: '' });
    setSaving(false);
  }

  async function deleteCanned(id: string) {
    await fetch(`/api/canned-responses/${id}`, { method: 'DELETE' });
    setCanned((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-sm text-gray-500 mt-1">Gérez votre compte et vos préférences.</p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(['general', 'canned'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'general' ? 'Général' : 'Réponses types'}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
          <h2 className="font-semibold text-gray-800">Informations de la boutique</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom de la boutique</label>
            <input
              placeholder="Nom de votre enseigne"
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email de support</label>
            <input
              type="email"
              placeholder="support@votre-boutique.fr"
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fuseau horaire</label>
            <select className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all">
              <option value="Europe/Paris">Europe/Paris (UTC+1/+2)</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New_York</option>
            </select>
          </div>
          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            {saved ? '✓ Sauvegardé' : 'Sauvegarder'}
          </button>
        </div>
      )}

      {tab === 'canned' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">Nouvelle réponse type</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Titre</label>
                <input
                  value={newCanned.title}
                  onChange={(e) => setNewCanned((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Ex : Retard de livraison"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-400 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Catégorie</label>
                <select
                  value={newCanned.category}
                  onChange={(e) => setNewCanned((f) => ({ ...f, category: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-400 transition-all"
                >
                  <option value="">— Aucune —</option>
                  <option value="delivery">Livraison</option>
                  <option value="return">Retour</option>
                  <option value="refund">Remboursement</option>
                  <option value="product">Produit</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contenu</label>
              <textarea
                value={newCanned.content}
                onChange={(e) => setNewCanned((f) => ({ ...f, content: e.target.value }))}
                rows={4}
                placeholder="Bonjour, nous avons bien reçu votre message concernant…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:border-indigo-400 transition-all"
              />
            </div>
            <button
              onClick={addCanned}
              disabled={saving || !newCanned.title.trim() || !newCanned.content.trim()}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Ajouter
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {canned.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Aucune réponse type. Ajoutez-en une ci-dessus.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {canned.map((cr) => (
                  <div key={cr.id} className="flex items-start gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900">{cr.title}</p>
                      {cr.category && <span className="text-xs text-gray-400 capitalize">{cr.category}</span>}
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{cr.content}</p>
                    </div>
                    <button
                      onClick={() => deleteCanned(cr.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 mt-0.5"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
