import type { ReactNode } from 'react';

import { SignInFrame } from '../../features/frame/ui/sign-in-frame';

export default function AuthorizeLayout({ children }: { children: ReactNode }) {
  return <SignInFrame>{children}</SignInFrame>;
}
