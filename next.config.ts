import type { NextConfig } from "next";

const USE_MOCK = process.env.USE_MOCK === "true";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com", pathname: "/dmxucnk9a/**" },
      { protocol: "https", hostname: "placehold.co" },
    ],
  },
  ...(USE_MOCK && {
    turbopack: {
      resolveAlias: {
        "@/lib/api": "./lib/api-mock",
        "@/lib/supabaseClient": "./lib/supabase-mock",
      },
    },
  }),
};

export default nextConfig;
