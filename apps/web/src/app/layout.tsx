import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers/session-provider';

export const metadata: Metadata = {
  title: { default: 'SupportHub – SAV E-commerce', template: '%s | SupportHub' },
  description: 'Plateforme SAV client unifiée pour Shopify et WooCommerce',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
