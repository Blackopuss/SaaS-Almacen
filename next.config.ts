import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating "N" indicator covered the theme switch and the sidebar
  // user menu. Compile and runtime errors are still shown when they happen.
  devIndicators: false,
};

export default nextConfig;
