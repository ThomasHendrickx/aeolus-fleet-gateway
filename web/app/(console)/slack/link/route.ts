import { startSlackLink } from '../../../../features/overview/hooks/start-slack-link';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<never> {
  return startSlackLink(request);
}
