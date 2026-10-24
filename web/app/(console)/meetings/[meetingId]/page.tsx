import type { Metadata } from 'next';

import { Meeting } from '../../../../features/meeting/state/meeting';
import type { SearchParams } from '../../../../lib/gateway-api/page-api';

export const metadata: Metadata = { title: 'Meeting' };

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ meetingId: string }>; searchParams: Promise<SearchParams> }) {
  const [{ meetingId }, query] = await Promise.all([params, searchParams]);
  return <Meeting meetingId={meetingId} searchParams={query} />;
}
