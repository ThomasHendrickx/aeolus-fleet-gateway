import type { Metadata } from 'next';

import { AuthorizeFailed } from '../../../features/authorize/ui/authorize-failed';

export const metadata: Metadata = { title: 'Connect an MCP client' };

export default async function AuthorizeFailedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { reason } = await searchParams;
  return <AuthorizeFailed reason={typeof reason === 'string' ? reason : undefined} />;
}
