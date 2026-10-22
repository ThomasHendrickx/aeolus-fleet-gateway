import type { Metadata } from 'next';

import { Overview } from '../../../features/overview/state/overview';
import type { SearchParams } from '../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Overview searchParams={await searchParams} />;
}
