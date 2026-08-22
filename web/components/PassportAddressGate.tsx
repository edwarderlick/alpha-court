"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppState } from "@/lib/store";

/** If /alpha-passport is opened with no ?address= and a wallet is
 *  connected, look up that wallet -- never silently show a hardcoded
 *  deploy-account passport as if it were "yours". */
export function PassportAddressGate() {
  const { wallet } = useAppState();
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (params.get("address")) return;
    if (wallet.status === "connected" && wallet.address) {
      router.replace(`/alpha-passport?address=${wallet.address}`);
    }
  }, [params, router, wallet.address, wallet.status]);

  return null;
}
