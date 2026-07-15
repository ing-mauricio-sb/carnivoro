import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
