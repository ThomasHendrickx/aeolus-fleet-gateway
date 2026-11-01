import { followChanges } from '../../../../features/bridge/hooks/follow-changes';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return followChanges(request);
}
