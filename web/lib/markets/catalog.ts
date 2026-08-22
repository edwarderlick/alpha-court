/** Curated spot pairs and protocols the court can actually price via Surf.
 *  These are display-side catalogs for the picker and tape -- Category A
 *  only. Settlement still uses whatever asset string the claim stored. */

export type SpotAsset = {
  symbol: string;
  ticker: string;
  name: string;
  icon: string;
};

export type ProtocolAsset = {
  id: string;
  name: string;
  ticker: string;
  icon: string;
};

const ICON = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color";
const COINCAP = "https://assets.coincap.io/assets/icons";
const LLAMA = "https://icons.llamao.fi/icons/protocols";

export const SPOT_ASSETS: SpotAsset[] = [
  { symbol: "BTC/USD", ticker: "BTC", name: "Bitcoin", icon: `${ICON}/btc.svg` },
  { symbol: "ETH/USD", ticker: "ETH", name: "Ethereum", icon: `${ICON}/eth.svg` },
  { symbol: "SOL/USD", ticker: "SOL", name: "Solana", icon: `${ICON}/sol.svg` },
  { symbol: "BNB/USD", ticker: "BNB", name: "BNB", icon: `${ICON}/bnb.svg` },
  { symbol: "XRP/USD", ticker: "XRP", name: "XRP", icon: `${ICON}/xrp.svg` },
  { symbol: "DOGE/USD", ticker: "DOGE", name: "Dogecoin", icon: `${ICON}/doge.svg` },
  { symbol: "ADA/USD", ticker: "ADA", name: "Cardano", icon: `${ICON}/ada.svg` },
  { symbol: "AVAX/USD", ticker: "AVAX", name: "Avalanche", icon: `${ICON}/avax.svg` },
  { symbol: "LINK/USD", ticker: "LINK", name: "Chainlink", icon: `${ICON}/link.svg` },
  { symbol: "SUI/USD", ticker: "SUI", name: "Sui", icon: `${COINCAP}/sui@2x.png` },
  { symbol: "NEAR/USD", ticker: "NEAR", name: "NEAR", icon: `${ICON}/near.svg` },
  { symbol: "APT/USD", ticker: "APT", name: "Aptos", icon: `${COINCAP}/apt@2x.png` },
  { symbol: "ARB/USD", ticker: "ARB", name: "Arbitrum", icon: `${ICON}/arb.svg` },
  { symbol: "OP/USD", ticker: "OP", name: "Optimism", icon: `${ICON}/op.svg` },
  { symbol: "UNI/USD", ticker: "UNI", name: "Uniswap", icon: `${ICON}/uni.svg` },
  { symbol: "AAVE/USD", ticker: "AAVE", name: "Aave", icon: `${ICON}/aave.svg` },
  { symbol: "PEPE/USD", ticker: "PEPE", name: "Pepe", icon: `${COINCAP}/pepe@2x.png` },
  { symbol: "WIF/USD", ticker: "WIF", name: "dogwifhat", icon: `${COINCAP}/wif@2x.png` },
];

export const TAPE_SYMBOLS = SPOT_ASSETS.slice(0, 10).map((a) => a.symbol);

export const FUNDAMENTALS_PROTOCOLS: ProtocolAsset[] = [
  { id: "uniswap", name: "Uniswap", ticker: "UNI", icon: `${LLAMA}/uniswap` },
  { id: "aave", name: "Aave", ticker: "AAVE", icon: `${LLAMA}/aave` },
  { id: "lido", name: "Lido", ticker: "LDO", icon: `${LLAMA}/lido` },
  { id: "makerdao", name: "Maker", ticker: "MKR", icon: `${LLAMA}/makerdao` },
  { id: "curve", name: "Curve", ticker: "CRV", icon: `${LLAMA}/curve-dex` },
];

export type AssetVisual = {
  ticker: string;
  name: string;
  icons: string[];
};

export function extractTicker(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "?";
  if (trimmed.includes("/")) return trimmed.split("/")[0].toUpperCase();
  return trimmed.toUpperCase();
}

export function assetVisual(raw: string | null | undefined): AssetVisual {
  const key = (raw ?? "").trim();
  const spot = findSpotAsset(key);
  if (spot) return { ticker: spot.ticker, name: spot.name, icons: [spot.icon, `${COINCAP}/${spot.ticker.toLowerCase()}@2x.png`] };
  const proto = FUNDAMENTALS_PROTOCOLS.find((p) => p.id === key.toLowerCase() || p.ticker === key.toUpperCase() || p.name.toLowerCase() === key.toLowerCase());
  if (proto) return { ticker: proto.ticker, name: proto.name, icons: [proto.icon] };
  const ticker = extractTicker(key);
  const lower = ticker.toLowerCase();
  return {
    ticker,
    name: key || ticker,
    icons: [`${ICON}/${lower}.svg`, `${COINCAP}/${lower}@2x.png`],
  };
}

export function findSpotAsset(symbol: string): SpotAsset | undefined {
  const key = symbol.trim().toUpperCase();
  return SPOT_ASSETS.find((a) => a.symbol === key || a.ticker === key);
}

export function formatSpotPrice(price: number): string {
  if (!Number.isFinite(price)) return "-";
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
