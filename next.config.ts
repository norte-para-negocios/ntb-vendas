import type { NextConfig } from "next";

const USE_MOCK = process.env.USE_MOCK === "true";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com", pathname: "/dmxucnk9a/**" },
      { protocol: "https", hostname: "placehold.co" },
      // Storage do proprio Supabase do projeto: pelo menos um produto real
      // (loja "Japanese") tem imagem enviada direto pra la, sem passar pelo
      // Cloudinary. Sem isso next/image derruba a tela inteira de qualquer
      // pagina que renderize esse produto.
      { protocol: "https", hostname: "giiwtnddasminjxweohr.supabase.co", pathname: "/storage/v1/object/public/**" },
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
