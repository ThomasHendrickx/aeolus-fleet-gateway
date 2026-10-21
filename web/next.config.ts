import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // The repository has its own guidance; Next writes no AGENTS.md or CLAUDE.md.
  agentRules: false,
};

export default config;
