import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const SEPOLIA_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

export const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(SEPOLIA_RPC_URL),
  },
});

// Deployed contract addresses on Sepolia (v7 - multi-outcome + hourly BTC)
export const DEPLOYED = {
  ConfidentialUSDT: "0xc35eA8889D2C09B2bCF3641236D325C4dF7318f1" as `0x${string}`,
  OracleResolver: "0x165C3B6635EB21A22cEc631046810941BC8731b9" as `0x${string}`,
  MarketFactory: "0x29B59C016616e644297a2b38Cf4Ef60E0F03a29B" as `0x${string}`,
};

// Chainlink price feed addresses on Sepolia
export const CHAINLINK_BTC_USD_SEPOLIA = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43" as `0x${string}`;

// Market group registry (populated after deploy)
// Each entry: { address, question, outcomeCount }
export const MARKET_GROUPS: { address: `0x${string}`; question: string }[] = [
  { address: "0x96A89c4de09054Bcb4222E3868d9a44ecC52Cca9", question: "Who wins 2028 US Presidential Election?" },
  { address: "0x7126c86A426d1133E452D66Fc2E27f9007950B23", question: "Manchester United vs Manchester City - Premier League" },
];
