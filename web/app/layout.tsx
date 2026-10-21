import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Frame } from '../features/frame/ui/frame';
import { geistMono, geistSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aeolus',
  robots: { index: false, follow: false },
};

/**
 * Sets the theme before the first paint: System, following the browser's
 * setting and keeping in step when it changes. Choosing a theme comes with
 * the shared header's avatar menu (header design H13).
 */
const THEME_SCRIPT = `(() => {
  const root = document.documentElement;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => root.classList.toggle('dark', query.matches);
  apply();
  query.addEventListener('change', apply);
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Frame
          header={
            <a href="/overview" className="text-section font-semibold">
              Aeolus
            </a>
          }
        >
          {children}
        </Frame>
      </body>
    </html>
  );
}
