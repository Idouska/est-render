'use client';

import { useState, useEffect } from 'react';
import { ShoppingBag, Globe, CheckCircle2, AlertCircle, Loader2, RefreshCw, Plus } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface Integration {
  id: string;
  platform: string;
  status: string;
  shopDomain?: string;
  storeUrl?: string;
  lastSyncAt?: string;
  syncedOrders: number;
  syncedCustomers: number;
}

function IntegrationCard({
  platform,
  integration,
  onConnect,
  onSync,
  syncing,
}: {
  platform: string;
  integration: Integration | null;
  onConnect: (platform: string) => void;
  onSync: (platform: string) => void;
  syncing: boolean;
}) {
  const isShopify = platform === 'SHOPIFY';
  const icon = isShopify ? '🛍️' : '🟣';
  const name = isShopify ? 'Shopify' : 'WooCommerce';
  const desc = isShopify
    ? 'Synchronisez vos commandes, clients et produits Shopify.'
    : 'Connectez votre boutique WooCommerce via clés API REST.';

  const connected = integration?.status === 'ACTIVE';

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{icon}</div>
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">{name}</h3>
            <p className="text-sm text-gray-500">{desc}</p>
          </div>
        </div>
        {connected ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-3 py-1.5 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" /> Connecté
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
            <AlertCircle className="w-3.5 h-3.5" /> Non connecté
          </span>
        )}
      </div>

      {connected && integration && (
        <div className="grid grid-cols-3 gap-3 mb-4 p-4 bg-gray-50 rounded-xl">
          <div className="text-center">
            <p className="text-xl font-bold text-gray-900">{integration.syncedOrders}</p>
            <p className="text-xs text-gray-500">Commandes</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-gray-900">{integration.syncedCustomers}</p>
            <p className="text-xs text-gray-500">Clients</p>
          </div>
          <div className="text-center">
            <p className="text-xs font-medium text-gray-700">Dernière sync</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {integration.lastSyncAt ? formatDate(integration.lastSyncAt) : 'Jamais'}
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {connected ? (
          <>
            <button
              onClick={() => onSync(platform)}
              disabled={syncing}
              className="flex-1 inline-flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Synchroniser
            </button>
            <button
              onClick={() => onConnect(platform)}
              className="px-4 py-2.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors"
            >
              Déconnecter
            </button>
          </>
        ) : (
          <button
            onClick={() => onConnect(platform)}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Connecter {name}
          </button>
        )}
      </div>
    </div>
  );
}

function ShopifyConnectModal({ onClose, onSave }: { onClose: () => void; onSave: (shop: string) => void }) {
  const [shop, setShop] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 className="font-bold text-gray-900 text-lg mb-4">Connecter Shopify</h3>
        <p className="text-sm text-gray-500 mb-5">Entrez le domaine de votre boutique Shopify pour initier la connexion OAuth.</p>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Domaine Shopify</label>
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden mb-5">
          <input
            value={shop}
            onChange={(e) => setShop(e.target.value.replace(/\.myshopify\.com.*/i, '').trim())}
            placeholder="votre-boutique"
            className="flex-1 px-4 py-2.5 text-sm"
          />
          <span className="px-3 bg-gray-50 text-gray-400 text-sm border-l border-gray-200 py-2.5">.myshopify.com</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSave(shop)}
            disabled={!shop.trim()}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            Autoriser via OAuth
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function WooConnectModal({ onClose, onSave }: { onClose: () => void; onSave: (data: any) => void }) {
  const [form, setForm] = useState({ storeUrl: '', consumerKey: '', consumerSecret: '' });
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave() {
    setError('');
    setTesting(true);
    const res = await fetch('/api/integrations/woocommerce/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setTesting(false);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Connexion échouée. Vérifiez vos clés API.');
      return;
    }
    onSave(form);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 className="font-bold text-gray-900 text-lg mb-2">Connecter WooCommerce</h3>
        <p className="text-sm text-gray-500 mb-5">
          Générez vos clés dans <strong>WooCommerce → Réglages → Avancé → REST API</strong>.
        </p>
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 mb-4 border border-red-200">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">URL du site WordPress</label>
            <input value={form.storeUrl} onChange={set('storeUrl')} placeholder="https://ma-boutique.com"
              className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:border-indigo-400 transition-all" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Consumer Key</label>
            <input value={form.consumerKey} onChange={set('consumerKey')} placeholder="ck_xxxxxxxxxxxxxxxx"
              className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:border-indigo-400 transition-all" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Consumer Secret</label>
            <input type="password" value={form.consumerSecret} onChange={set('consumerSecret')} placeholder="cs_xxxxxxxxxxxxxxxx"
              className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:border-indigo-400 transition-all" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} disabled={testing || !form.storeUrl || !form.consumerKey || !form.consumerSecret}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {testing && <Loader2 className="w-4 h-4 animate-spin" />}
            Tester et connecter
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [modal, setModal] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/integrations').then((r) => r.json()).then(setIntegrations);
  }, []);

  function getIntegration(platform: string) {
    return integrations.find((i) => i.platform === platform) ?? null;
  }

  async function handleSync(platform: string) {
    setSyncing(platform);
    const endpoint = platform === 'SHOPIFY' ? '/api/integrations/shopify/sync' : '/api/integrations/woocommerce/sync';
    await fetch(endpoint, { method: 'POST' });
    const updated = await fetch('/api/integrations').then((r) => r.json());
    setIntegrations(updated);
    setSyncing(null);
  }

  function handleShopifyConnect(shop: string) {
    window.location.href = `/api/integrations/shopify/connect?shop=${shop}`;
  }

  async function handleWooConnect(data: any) {
    const updated = await fetch('/api/integrations').then((r) => r.json());
    setIntegrations(updated);
    setModal(null);
  }

  function handleConnect(platform: string) {
    setModal(platform);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Intégrations</h1>
        <p className="text-sm text-gray-500 mt-1">Connectez vos boutiques pour synchroniser commandes et clients.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <IntegrationCard
          platform="SHOPIFY"
          integration={getIntegration('SHOPIFY')}
          onConnect={handleConnect}
          onSync={handleSync}
          syncing={syncing === 'SHOPIFY'}
        />
        <IntegrationCard
          platform="WOOCOMMERCE"
          integration={getIntegration('WOOCOMMERCE')}
          onConnect={handleConnect}
          onSync={handleSync}
          syncing={syncing === 'WOOCOMMERCE'}
        />
      </div>

      <div className="bg-blue-50 rounded-xl p-5 border border-blue-100">
        <h3 className="font-semibold text-blue-900 mb-2">Webhooks configurés automatiquement</h3>
        <p className="text-sm text-blue-700 leading-relaxed">
          Lors de la connexion, SupportHub enregistre automatiquement des webhooks sur votre boutique pour recevoir
          les nouvelles commandes, mises à jour et créations clients en temps réel — sans synchronisation manuelle.
        </p>
      </div>

      {modal === 'SHOPIFY' && (
        <ShopifyConnectModal onClose={() => setModal(null)} onSave={handleShopifyConnect} />
      )}
      {modal === 'WOOCOMMERCE' && (
        <WooConnectModal onClose={() => setModal(null)} onSave={handleWooConnect} />
      )}
    </div>
  );
}
