import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@zama-fhe/relayer-sdk"],
  webpack: (config, { isServer }) => {
    // WASM support for @zama-fhe/relayer-sdk (tfhe_bg.wasm, kms_lib_bg.wasm)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
