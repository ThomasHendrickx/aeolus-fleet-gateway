import type { Theme } from '@aeolus-fleet/common';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { readTheme } from '../features/frame/hooks/read-theme';
import { geistMono, geistSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aeolus',
  robots: { index: false, follow: false },
};

/**
 * Sets the theme this browser chose before the first paint: System follows
 * the browser's setting and keeps in step while <html> says system.
 */
function themeScript(theme: Theme): string {
  return `(() => {
  const root = document.documentElement;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => root.classList.toggle('dark', root.dataset.theme === 'dark' || (root.dataset.theme === 'system' && query.matches));
  root.dataset.theme = ${JSON.stringify(theme)};
  apply();
  query.addEventListener('change', apply);
})();`;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = await readTheme();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
