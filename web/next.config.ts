import type { NextConfig } from "next";

// Bake GitHub-secret-injected build env into the server bundle. Vercel
// function runtime does not receive those GHA env vars; only NEXT_PUBLIC_*
// is reliably inlined otherwise, and /api/* was 500ing on a missing
// ALPHA_COURT_CONTRACT_ADDRESS at request time.
const CONTRACT =
  process.env.ALPHA_COURT_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS ||
  "";
const TREASURY =
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
  "0x374D46E81973dd8797f14f586AEE94AaC27e39A3";

const nextConfig: NextConfig = {
  env: {
    ALPHA_COURT_CONTRACT_ADDRESS: CONTRACT,
    NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS: CONTRACT,
    NEXT_PUBLIC_TREASURY_ADDRESS: TREASURY,
  },
};

export default nextConfig;
