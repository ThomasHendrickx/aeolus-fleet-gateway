import { followFocus } from '../../../../features/overview/hooks/follow-changes';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return followFocus(request);
}
