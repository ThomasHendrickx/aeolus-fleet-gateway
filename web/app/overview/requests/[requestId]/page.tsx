import type { Metadata } from 'next';

import { RequestToDecide } from '../../../../features/overview/state/request-to-decide';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'To decide' };

export default async function RequestToDecidePage({ params, searchParams }: { params: Promise<{ requestId: string }>; searchParams: Promise<SearchParams> }) {
  const [{ requestId }, query] = await Promise.all([params, searchParams]);
  return <RequestToDecide requestId={requestId} searchParams={query} />;
}
