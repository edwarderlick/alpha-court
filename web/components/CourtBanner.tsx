import { currentCourtAddress, RETIRED_COURTS, shortCourt } from "@/lib/legacy-claim-ids";

export function CourtBanner() {
  const live = currentCourtAddress();
  const retired = RETIRED_COURTS.map((c) => shortCourt(c.address)).join(", ");
  return (
    <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
      Live court {shortCourt(live) || "unset"} · claims on {retired} are
      historical (legacy docket)
    </p>
  );
}
