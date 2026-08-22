import { currentCourtAddress, RETIRED_COURT_ADDRESS, shortCourt } from "@/lib/legacy-claim-ids";

export function CourtBanner() {
  const live = currentCourtAddress();
  return (
    <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
      Live court {shortCourt(live) || "unset"} · claims on {shortCourt(RETIRED_COURT_ADDRESS)} are
      historical (legacy docket)
    </p>
  );
}
