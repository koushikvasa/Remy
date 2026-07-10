/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile the shared workspace package (exported as TS source).
  transpilePackages: ["@remy/shared"],
};

export default nextConfig;
