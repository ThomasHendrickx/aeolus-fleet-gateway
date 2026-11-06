import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// The package as npm publishes it; the build writes src/ to dist/ (tsconfig.build.json).
import packageJson from '../../../package.json' with { type: 'json' };

describe("the gateway's API router type", () => {
  it('is published at @aeolus-fleet/gateway/api, as the declaration the build writes for the router', () => {
    expect(packageJson.exports['./api']).toEqual({ types: './dist/adapters/trpc/router.d.ts' });
    expect(existsSync(new URL('./router.ts', import.meta.url))).toBe(true);
  });
});
