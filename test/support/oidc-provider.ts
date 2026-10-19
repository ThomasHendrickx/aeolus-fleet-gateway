import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { OIDC_PROVIDER_IMAGE } from './container-images.js';

/** The provider's port in its container. */
const PORT = 8080;

/** The gateway's client at the test provider, as argo registers it there. */
export const PROVIDER_CLIENT_ID = 'gateway';

/** The person the provider at `company` signs in, whoever asks: as a company's provider vouches for its employee. */
export const CHARLOTTE = { subject: 'charlotte-sub', email: 'charlotte@example.com' };

/** Signs in without a login page (the provider's non-interactive mode), so a test follows the redirects alone. */
const CONFIGURATION = JSON.stringify({
  interactiveLogin: false,
  tokenCallbacks: [
    {
      issuerId: 'company',
      tokenExpiry: 3600,
      requestMappings: [{ requestParam: 'client_id', match: '*', claims: { sub: CHARLOTTE.subject, email: CHARLOTTE.email, email_verified: true, aud: [PROVIDER_CLIENT_ID] } }],
    },
  ],
});

/**
 * A company identity provider for the tests: navikt's mock OAuth2 server, a
 * real OpenID provider that serves any issuer id under its root and signs in
 * whoever the test names. The JVM starts a few dozen threads, so it states a
 * process limit: a runtime's default can be lower than the JVM needs.
 */
class OidcProviderContainer extends GenericContainer {
  constructor() {
    super(OIDC_PROVIDER_IMAGE);
    this.withExposedPorts(PORT).withEnvironment({ JSON_CONFIG: CONFIGURATION }).withWaitStrategy(Wait.forHttp('/default/.well-known/openid-configuration', PORT));
    this.hostConfig.PidsLimit = 4096;
  }
}

export interface OidcProvider {
  /** The issuer of one identity provider the server serves, by its id. */
  issuerOf(id: string): string;
  stop(): Promise<void>;
}

export async function startOidcProvider(): Promise<OidcProvider> {
  const started: StartedTestContainer = await new OidcProviderContainer().start();
  const root = `http://${started.getHost()}:${String(started.getMappedPort(PORT))}`;
  return {
    issuerOf: (id) => `${root}/${id}`,
    stop: async () => {
      await started.stop();
    },
  };
}
