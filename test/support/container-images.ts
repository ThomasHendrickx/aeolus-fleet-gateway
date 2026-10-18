/**
 * The images Testcontainers pulls for the tests, from mirrors outside Docker
 * Hub: CI runners share IPs, so anonymous Docker Hub pulls hit its rate limit
 * at random (#437). Both mirrors serve the same image as Docker Hub and need
 * no sign-in. ECR Public throttles anonymous pulls per IP too (#464), so CI
 * keeps the images in the Actions cache; it lists them by running this file
 * (see .github/actions/test-images).
 */

/** Postgres 16, the oldest version the architecture supports, from Docker's official images on Amazon ECR Public. */
export const POSTGRES_IMAGE = 'public.ecr.aws/docker/library/postgres:16-alpine';

/** Ryuk, the reaper Testcontainers starts to remove containers a run leaves behind, from Testcontainers' own GitHub registry. */
export const REAPER_IMAGE = 'ghcr.io/testcontainers/ryuk:0.14.0';

/** Every image the tests start, one per line when this file runs, for CI to cache. */
export const TEST_IMAGES: readonly string[] = [POSTGRES_IMAGE, REAPER_IMAGE];

if (import.meta.main) {
  console.log(TEST_IMAGES.join('\n'));
}
