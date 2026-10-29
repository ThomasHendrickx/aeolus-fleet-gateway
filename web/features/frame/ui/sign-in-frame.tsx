import { Avatar } from '@aeolus-fleet/common/header';
import type { ReactNode } from 'react';

/**
 * A page a person meets on their way in, from an outside MCP client: the
 * Aeolus mark and its name above one centred column, no app header.
 */
export function SignInFrame({ children }: { children: ReactNode }) {
  return (
    <main data-testid="sign-in-frame" className="mx-auto grid min-h-dvh w-full max-w-110 content-center justify-items-center gap-4 px-4 py-8 text-center">
      <div className="flex items-center gap-2 font-semibold">
        <Avatar kind="app" />
        Aeolus
      </div>
      <div className="grid w-full gap-4">{children}</div>
    </main>
  );
}
