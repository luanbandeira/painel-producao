import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Limite de upload das planilhas. O arquivo típico tem ~50 KB;
      // 12mb dá folga para crescimento da base + overhead do multipart.
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Sistema interno: não deve ser indexado nem embutido em iframes
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          // Só HTTPS por um ano. Sem `preload`: entrar na lista dos
          // navegadores é decisão à parte e difícil de desfazer.
          // A Content-Security-Policy não fica aqui — precisa de um nonce
          // por resposta e é montada em src/proxy.ts.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
