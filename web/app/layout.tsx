import { themeScript, Toaster } from '@aeolus-fleet/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { readTheme } from '../features/frame/hooks/read-theme';
import { GATEWAY_PAGE_TITLE } from '../lib/page-title';
import { geistMono, geistSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: GATEWAY_PAGE_TITLE,
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The browser's one theme from the first paint, in every Aeolus app (header-across-apps T1).
  const { theme } = await readTheme();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />
      </head>
      <body>{children}<Toaster /></body>
    </html>
  );
}
