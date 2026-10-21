import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { failedPage, readClient } from '../../../features/authorize/hooks/read-authorize';
import { pickFieldsOf } from '../../../features/authorize/services/authorize';
import { ConnectClient } from '../../../features/authorize/ui/connect-client';
import type { SearchParams } from '../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Connect an MCP client' };

export default async function PickPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const fields = pickFieldsOf(await searchParams);
  const read = await readClient(fields);
  if (read.kind === 'failed') {
    redirect(failedPage(read.reason));
  }
  return <ConnectClient client={read.client} fields={fields} />;
}
