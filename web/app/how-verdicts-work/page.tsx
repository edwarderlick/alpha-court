import { AppShell } from "@/components/AppShell";

/**
 * Converted from how_verdicts_work_pro_theme/code.html. Its source shipped
 * a THIRD, minimal nav variant (top-only, DOCKET/VOTING/REPUTATION links —
 * none of which correspond to real routes elsewhere in the app). Per
 * Task 3, normalized onto the canonical AppShell like activity/my-claims;
 * flagged rather than silently reproduced as a one-off nav.
 */
const STEPS = [
  {
    n: "01",
    icon: "gavel",
    title: "FORMAL CLAIM",
    body: "Accusation logged on-chain. Timestamped and immutable. The origin point of protocol friction.",
    featured: false,
  },
  {
    n: "02",
    icon: "database",
    title: "SURF EVIDENCE",
    body: "Automated gathering via crypto-native API. Typed facts synthesized directly from the chain state. Zero manual scraping.",
    featured: true,
  },
  {
    n: "03",
    icon: "architecture",
    title: "LEADER VERDICT",
    body: "Designated validator constructs a reasoned argument citing Surf data. Cryptographic proof meets logical deduction.",
    featured: false,
  },
  {
    n: "04",
    icon: "account_balance",
    title: "VALIDATOR CONSENSUS",
    body: "Other validators independently re-read the same Surf snapshots and accept or reject the leader verdict under published criteria. There is no fixed public 3-of-5 number in this app — Studio's validator set is the real quorum.",
    featured: false,
  },
  {
    n: "05",
    icon: "terminal",
    title: "OUTCOME & APPEAL",
    body: "A decisive HELD or BROKEN stores that outcome from the verdict text and records Passport. Stakes and appeal bonds are sent to a published treasury wallet, never into the contract — Studio cannot push GEN out of an Intelligent Contract. Payouts are still keeper native sends from that same treasury. The system is custody-free at the contract, not trustless end to end. My Stakes marks Paid only after the wallet balance actually increases.",
    featured: false,
  },
];

export default function HowVerdictsWorkPage() {
  return (
    <AppShell activeSide="Rules">
      <main className="relative z-10 pb-section-padding px-gutter max-w-7xl mx-auto flex flex-col gap-section-padding">
        <header className="flex flex-col items-start gap-4 md:gap-8 transform -rotate-1 pt-8">
          <h1
            className="font-display-hero-mobile md:font-display-hero text-display-hero-mobile md:text-display-hero text-primary glitch-text uppercase"
            data-text="HOW VERDICTS WORK"
          >
            HOW VERDICTS WORK
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-3xl border-l-4 border-secondary-fixed pl-6 py-2 bg-surface-container-low/50 backdrop-blur-sm shadow-[5px_0_15px_rgba(199,243,0,0.1)]">
            The decentralized arbitration engine. Immutable claims, cryptographic evidence, and validator consensus operating at high-tech friction.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-12 gap-gutter relative">
          <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-1 bg-outline-variant/30 transform -translate-x-1/2 z-0"></div>
          {STEPS.map((step, i) => (
            <div
              key={step.n}
              className={`md:col-span-5 ${i % 2 === 0 ? "" : "md:col-start-8"} flex flex-col gap-4 relative z-10 hover:translate-x-2 transition-transform duration-300`}
            >
              <div
                className={
                  step.featured
                    ? "bg-surface-container-high border-2 border-secondary-fixed/50 p-6 rounded-xl flex flex-col gap-4 shadow-lg group relative overflow-hidden"
                    : "bg-surface-container-high border-2 border-outline-variant p-6 rounded-xl flex flex-col gap-4 shadow-lg group"
                }
              >
                {step.featured && (
                  <div className="absolute -right-10 -top-10 bg-secondary-fixed text-on-secondary-fixed font-label-mono-bold text-label-mono-bold py-1 px-12 transform rotate-45 z-20">
                    LIVE DATA VIA SURF
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span
                    className={
                      step.featured
                        ? "font-display-lg text-display-lg text-secondary-fixed opacity-50 group-hover:opacity-100 transition-colors"
                        : "font-display-lg text-display-lg text-primary opacity-50 group-hover:opacity-100 group-hover:text-secondary-fixed transition-colors"
                    }
                  >
                    {step.n}
                  </span>
                  <div
                    className={
                      step.featured
                        ? "w-12 h-12 rounded-full bg-surface-container flex items-center justify-center border border-secondary-fixed neon-glow-secondary transition-all"
                        : "w-12 h-12 rounded-full bg-surface-container flex items-center justify-center border border-primary-container neon-glow-primary group-hover:neon-glow-secondary transition-all"
                    }
                  >
                    <span
                      className={step.featured ? "material-symbols-outlined text-secondary-fixed" : "material-symbols-outlined text-primary group-hover:text-secondary-fixed"}
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      {step.icon}
                    </span>
                  </div>
                </div>
                <h3 className="font-display-md text-display-md text-secondary">{step.title}</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">{step.body}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </AppShell>
  );
}
