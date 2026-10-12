import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No AGENTS.md: since 16.3, `next dev` writes one into the project, and
  // puts it back if removed, whenever it detects a coding agent (11 Oct 2026).
  agentRules: false,
};

export default nextConfig;
