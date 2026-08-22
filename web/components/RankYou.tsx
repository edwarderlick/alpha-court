"use client";

import { useEffect } from "react";
import { useAppState } from "@/lib/store";

/** Marks the connected wallet's ranking row. Purely visual. */
export function RankYou() {
  const { wallet } = useAppState();
  const address = wallet.status === "connected" ? wallet.address : null;

  useEffect(() => {
    const rows = document.querySelectorAll<HTMLElement>("[data-rank-address]");
    rows.forEach((row) => {
      const mine = Boolean(address && row.dataset.rankAddress === address.toLowerCase());
      row.classList.toggle("rank-you", mine);
    });
  }, [address]);

  return null;
}
