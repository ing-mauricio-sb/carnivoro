import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-sg',
  display: 'swap',
});

// "Big Shoulders Display" was merged into the new "Big Shoulders" family
// upstream (different letterforms at small sizes via its opsz axis), so it is
// no longer available through next/font/google. We self-host the exact
// variable woff2 the legacy Google endpoint still serves today.
const bigShoulders = localFont({
  src: '../fonts/big-shoulders-display-latin-var.woff2',
  weight: '500 900',
  variable: '--font-bsd',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Carnívoro — La mejor hamburguesa 100% pura carne',
  description:
    'Hamburguesas artesanales 100% pura carne. +20 sedes en el Perú. Pide delivery o vive el Reto Carnívoro.',
  openGraph: {
    title: 'Carnívoro — La mejor hamburguesa 100% pura carne',
    description:
      'Hamburguesas artesanales 100% pura carne. +20 sedes en el Perú. Pide delivery o vive el Reto Carnívoro.',
    locale: 'es_PE',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0c0a09',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${bigShoulders.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
