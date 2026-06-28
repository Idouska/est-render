import Link from 'next/link';
import {
  MessageSquare, ShoppingBag, Zap, BarChart3, Shield, Globe,
  ArrowRight, CheckCircle2, Star
} from 'lucide-react';

const features = [
  {
    icon: MessageSquare,
    title: 'Tickets unifiés',
    description: 'Centralisez tous les messages clients (email, chat, formulaire) dans une seule interface claire et partageable avec votre équipe.',
  },
  {
    icon: ShoppingBag,
    title: 'Shopify & WooCommerce',
    description: "Accédez aux commandes, statuts et historiques d'achat directement depuis le ticket, sans changer d'onglet.",
  },
  {
    icon: Zap,
    title: 'Réponses rapides',
    description: 'Bibliothèque de réponses types personnalisables pour les situations récurrentes : retours, remboursements, livraisons.',
  },
  {
    icon: BarChart3,
    title: 'Analytiques en temps réel',
    description: 'Taux de résolution, temps de réponse moyen, satisfaction client, volume par canal — tout en un coup d\'œil.',
  },
  {
    icon: Shield,
    title: 'Multi-agents & rôles',
    description: 'Assignez les tickets à vos agents, définissez des rôles (admin, agent), suivez la charge de travail de chacun.',
  },
  {
    icon: Globe,
    title: 'Multi-boutiques',
    description: 'Gérez plusieurs boutiques Shopify ou sites WooCommerce depuis un seul compte SupportHub.',
  },
];

const plans = [
  {
    name: 'Starter',
    price: '29',
    desc: 'Pour les boutiques qui démarrent',
    features: ['1 intégration (Shopify ou WC)', '2 agents', '500 tickets/mois', 'Email support'],
    cta: 'Commencer gratuitement',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '79',
    desc: 'Pour les équipes en croissance',
    features: [
      'Shopify + WooCommerce',
      '10 agents',
      'Tickets illimités',
      'Analytiques avancées',
      'Réponses automatiques',
      'Support prioritaire',
    ],
    cta: 'Essai gratuit 14 jours',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Sur devis',
    desc: 'Pour les grands volumes',
    features: [
      'Boutiques illimitées',
      'Agents illimités',
      'SLA garanti',
      'Onboarding dédié',
      'SSO / API privée',
    ],
    cta: 'Nous contacter',
    highlight: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl text-indigo-600">
            <MessageSquare className="w-6 h-6" />
            SupportHub
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm text-gray-600 hover:text-gray-900">Fonctionnalités</a>
            <a href="#pricing" className="text-sm text-gray-600 hover:text-gray-900">Tarifs</a>
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Connexion</Link>
            <Link
              href="/register"
              className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Essai gratuit
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-sm font-medium px-4 py-2 rounded-full mb-8">
          <Star className="w-4 h-4 fill-indigo-500" />
          Intégration Shopify & WooCommerce native
        </div>
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight mb-6">
          Le SAV e-commerce qui<br />
          <span className="text-indigo-600">convertit les retours en fidélité</span>
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
          Centralisez vos tickets clients, accédez aux commandes Shopify et WooCommerce
          en un clic, et résolvez les problèmes 3x plus vite.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-indigo-600 text-white font-semibold px-8 py-4 rounded-xl hover:bg-indigo-700 transition-colors text-lg shadow-lg shadow-indigo-200"
          >
            Démarrer gratuitement
            <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 font-medium px-8 py-4 rounded-xl hover:bg-gray-50 transition-colors text-lg"
          >
            Voir la démo
          </Link>
        </div>
        <p className="mt-4 text-sm text-gray-400">Sans carte bancaire · 14 jours d'essai</p>
      </section>

      {/* Social proof */}
      <section className="bg-gray-50 border-y border-gray-100 py-10">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-sm text-gray-400 uppercase tracking-wider mb-6">Ils nous font confiance</p>
          <div className="flex items-center justify-center gap-12 text-gray-300 font-bold text-xl">
            {['Maison Léa', 'VeloShop.fr', 'NaturaBio', 'TechParts', 'ModaStyle'].map(b => (
              <span key={b}>{b}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Tout ce qu'il faut pour un SAV de qualité</h2>
          <p className="text-lg text-gray-500 max-w-xl mx-auto">
            Une plateforme pensée pour les marchands e-commerce qui veulent transformer leur service client en avantage compétitif.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="p-6 rounded-2xl border border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all">
              <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-4">
                <Icon className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">{title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-gray-50 py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Tarifs simples et prévisibles</h2>
            <p className="text-gray-500">Pas de frais cachés. Évoluez à votre rythme.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-8 border ${
                  plan.highlight
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-200 scale-105'
                    : 'bg-white border-gray-200'
                }`}
              >
                <div className={`text-sm font-medium mb-1 ${plan.highlight ? 'text-indigo-200' : 'text-gray-500'}`}>
                  {plan.desc}
                </div>
                <div className="text-3xl font-bold mb-1">
                  {plan.price === 'Sur devis' ? plan.price : `${plan.price}€`}
                  {plan.price !== 'Sur devis' && (
                    <span className={`text-base font-normal ml-1 ${plan.highlight ? 'text-indigo-200' : 'text-gray-400'}`}>/mois</span>
                  )}
                </div>
                <div className={`font-semibold text-xl mb-6 ${plan.highlight ? 'text-white' : 'text-gray-900'}`}>{plan.name}</div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${plan.highlight ? 'text-indigo-200' : 'text-indigo-500'}`} />
                      <span className={plan.highlight ? 'text-indigo-100' : 'text-gray-600'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={`block text-center font-semibold py-3 rounded-xl transition-colors ${
                    plan.highlight
                      ? 'bg-white text-indigo-600 hover:bg-indigo-50'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-12">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold text-lg text-indigo-600">
            <MessageSquare className="w-5 h-5" />
            SupportHub
          </div>
          <p className="text-sm text-gray-400">© 2025 SupportHub. Tous droits réservés.</p>
          <div className="flex gap-6 text-sm text-gray-400">
            <a href="#" className="hover:text-gray-600">Confidentialité</a>
            <a href="#" className="hover:text-gray-600">CGU</a>
            <a href="#" className="hover:text-gray-600">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
