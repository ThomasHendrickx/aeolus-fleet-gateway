import { AuthorizeFailed } from '../../../features/authorize/ui/authorize-failed';

export default async function AuthorizeFailedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { reason } = await searchParams;
  return <AuthorizeFailed reason={typeof reason === 'string' ? reason : undefined} />;
}
