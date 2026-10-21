import type { Metadata } from 'next';

import { SignInFailed } from '../../../features/sign-in/ui/sign-in-failed';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInFailedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { reason } = await searchParams;
  return <SignInFailed reason={typeof reason === 'string' ? reason : undefined} />;
}
