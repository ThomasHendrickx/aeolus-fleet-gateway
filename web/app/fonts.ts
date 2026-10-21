import localFont from 'next/font/local';

/**
 * Geist and Geist Mono, self-hosted (SIL Open Font License, fonts/OFL.txt).
 * tokens.css reads the two variables first in --font-sans and --font-mono.
 */
export const geistSans = localFont({
  src: './fonts/geist-variable.woff2',
  variable: '--font-geist-sans',
  weight: '100 900',
});

export const geistMono = localFont({
  src: './fonts/geist-mono-variable.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
});
