import type { Metadata } from "next";
import "./globals.css";
import { AppStateProvider } from "@/lib/store";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { MarketPulseHost } from "@/components/MarketPulseHost";

export const metadata: Metadata = {
  title: "ALPHA COURT | Immutable Justice Protocol",
  description: "Decentralized arbitration for crypto-legal claims.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;500;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-on-surface font-body-md antialiased" suppressHydrationWarning>
        <AppStateProvider>
          {children}
          <WalletConnectModal />
          <MarketPulseHost />
        </AppStateProvider>
      </body>
    </html>
  );
}
