"use client";

const BRAND_ICON: Record<string, string> = {
  "io.metamask": "/wallets/metamask.svg",
  "io.metamask.flask": "/wallets/metamask.svg",
  "com.coinbase.wallet": "/wallets/coinbase.svg",
  "walletconnect": "/wallets/walletconnect.svg",
};

function brandSrc(rdns?: string, name?: string): string | undefined {
  if (rdns && BRAND_ICON[rdns]) return BRAND_ICON[rdns];
  const key = `${rdns ?? ""} ${name ?? ""}`.toLowerCase();
  if (key.includes("metamask")) return "/wallets/metamask.svg";
  if (key.includes("coinbase")) return "/wallets/coinbase.svg";
  if (key.includes("walletconnect")) return "/wallets/walletconnect.svg";
  return undefined;
}

export function WalletGlyph({
  name,
  rdns,
  icon,
}: {
  name: string;
  rdns?: string;
  icon?: string;
}) {
  const src = icon && icon.length > 8 ? icon : brandSrc(rdns, name);
  return (
    <div className="w-12 h-12 bg-black/50 rounded-full flex items-center justify-center border border-white/10 group-hover:border-secondary-container transition-colors overflow-hidden p-1.5 shrink-0">
      {src ? (
        // EIP-6963 icons are data URIs from the wallet; brand SVGs are local.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-full object-contain" draggable={false} />
      ) : (
        <svg viewBox="0 0 32 32" className="w-7 h-7 text-white/80" fill="none" aria-hidden>
          <rect x="4" y="8" width="24" height="16" rx="3" stroke="currentColor" strokeWidth="1.75" />
          <path d="M4 14h24" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="21.5" cy="19" r="1.5" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}
