import type { Metadata } from 'next';

import { ADD_SERVER_PATH } from '../../../features/outside-parties/paths';
import { NoSignIn } from '../../../features/sign-in/ui/no-sign-in';
import { signedInPage, type SearchParams } from '../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Add MCP server' };

export default async function AddServerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await signedInPage({ path: ADD_SERVER_PATH, searchParams: await searchParams });
  if (page.kind === 'noSignIn') {
    return <NoSignIn />;
  }
  return <h1 className="text-title font-semibold">Add MCP server</h1>;
}
