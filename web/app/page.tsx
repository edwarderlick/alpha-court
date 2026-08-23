import Link from "next/link";
import { AlphaMark } from "@/components/AlphaMark";
import { ShaderBackground } from "@/components/ShaderBackground";
import { ScrollFadeIn } from "@/components/ScrollFadeIn";
import { LandingClock } from "@/components/LandingClock";
import { LandingCast, CastParade } from "@/components/LandingCast";
import { LandingTape } from "@/components/LandingTape";
import { LiveCarousel } from "@/components/LiveCarousel";
import { getLandingBundle, summarizeLanding } from "@/lib/genlayer/claims";
import { formatGen } from "@/lib/genlayer/claim-display";

export default async function LandingPage() {
  let claims: Awaited<ReturnType<typeof getLandingBundle>>["claims"] = [];
  let total = 0;
  try {
    const bundle = await getLandingBundle();
    claims = bundle.claims;
    total = bundle.total;
  } catch {
    claims = [];
    total = 0;
  }
  const stats = summarizeLanding(claims);
  const docketCount = Math.max(total, stats.total);
  const openCount = stats.open;
  const settledCount = stats.settled;
  const genInPlay = stats.genInPlay;
  const pool = claims[0]
    ? (parseFloat(claims[0].stake_for_total) || 0) + (parseFloat(claims[0].stake_against_total) || 0)
    : 0;
  const forPct = pool > 0 ? ((parseFloat(claims[0].stake_for_total) || 0) / pool) * 100 : 62;
  const againstPct = pool > 0 ? 100 - forPct : 38;

  return (
    <div className="font-sans text-black antialiased overflow-x-hidden selection:bg-alpha-purple selection:text-white">
      <ShaderBackground />
      <ScrollFadeIn />

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 mix-blend-difference text-white">
        <Link href="/" className="flex items-center gap-2 text-white" aria-label="Alpha Court">
          <AlphaMark variant="mono" className="h-7 w-7" />
        </Link>
        <div className="hidden md:flex gap-8 font-mono text-sm uppercase tracking-widest font-bold">
          <Link className="hover:text-alpha-purple transition-colors duration-300 ease-snappy" href="/">Home</Link>
          <Link className="hover:text-alpha-purple transition-colors duration-300 ease-snappy" href="/browse-cases">Markets</Link>
          <Link className="hover:text-alpha-purple transition-colors duration-300 ease-snappy" href="/leaderboard">Rankings</Link>
          <Link className="hover:text-alpha-purple transition-colors duration-300 ease-snappy" href="/post-a-claim">Submit</Link>
        </div>
        <Link href="/browse-cases" className="w-8 h-8 flex flex-col justify-center items-center gap-1.5 group">
          <span className="w-6 h-0.5 bg-white group-hover:bg-alpha-purple transition-colors duration-300 ease-snappy"></span>
          <span className="w-6 h-0.5 bg-white group-hover:bg-alpha-purple transition-colors duration-300 ease-snappy"></span>
        </Link>
      </nav>

      <header className="relative min-h-[100dvh] pt-24 px-8 flex flex-col overflow-hidden bg-white-layer">
        <div className="scanlines"></div>
        <LandingCast />
        <div className="relative z-[16] flex-1 flex flex-col justify-center font-display leading-[0.8] uppercase w-full">
          <h1 className="text-[clamp(4rem,15vw,12rem)] text-outline-dark opacity-10 m-0 glitch-text" data-text="ALPHA">ALPHA</h1>
          <h1 className="text-[clamp(5rem,20vw,16rem)] text-black m-0 tracking-tighter glitch-text" data-text="COURT">
            COURT<sup className="text-4xl align-top">&reg;</sup>
          </h1>
          <h1 className="text-[clamp(5rem,20vw,16rem)] text-black m-0 tracking-tighter glitch-text" data-text="2026">2026</h1>
          <h1 className="text-[clamp(4rem,15vw,12rem)] text-outline-dark opacity-10 m-0 glitch-text" data-text="CHOICE">CHOICE</h1>
        </div>
        <div className="absolute top-24 right-8 z-20 w-80 bg-alpha-purple rounded-3xl p-6 text-white shadow-2xl transform rotate-1 hover:rotate-0 transition-all duration-300 ease-snappy glow-purple">
          <div className="flex justify-between items-start mb-6">
            <div className="flex gap-4 font-mono font-bold">
              <div>
                <span className="block text-2xl">{docketCount}</span>
                <span className="text-[10px] uppercase">Dockets</span>
              </div>
              <div>
                <span className="block text-2xl">3</span>
                <span className="text-[10px] uppercase">Claim types</span>
              </div>
              <div>
                <span className="block text-2xl">GEN</span>
                <span className="text-[10px] uppercase">Stake unit</span>
              </div>
            </div>
            <Link href="/browse-cases" className="bg-black text-white text-xs font-mono font-bold px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-white hover:text-black transition-all duration-300 ease-snappy glow-lime">
              MARKETS
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
              </svg>
            </Link>
          </div>
          <div className="font-mono text-center mb-2 text-xs uppercase opacity-80 glow-text-purple">Open a docket</div>
          <div className="font-display text-3xl tracking-wider glow-text-purple text-center leading-none">LIVE MARKETS</div>
          <div className="mt-4 text-[10px] font-mono text-center text-lime-green uppercase tracking-widest flex items-center justify-center gap-1">
            <span className="w-2 h-2 rounded-full bg-lime-green animate-pulse-fast glow-lime"></span>
            {docketCount} on-chain claims
          </div>
        </div>
        <div className="absolute bottom-8 right-8 z-20 flex gap-2">
          <Link href="/browse-cases" className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center hover:bg-alpha-purple hover:scale-110 transition-all duration-300 ease-snappy">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
            </svg>
          </Link>
        </div>
      </header>

      <LandingTape claims={claims} />

      <section className="bg-white-layer py-16 px-8 border-b-2 border-gray-100 relative overflow-hidden">
        <CastParade />
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-12 items-center relative z-10">
          <div className="flex flex-wrap gap-2 w-full md:w-1/4">
            <span className="bg-red-500 text-white font-mono text-[10px] uppercase font-bold px-3 py-1 rounded-full hover:scale-105 transition-transform duration-300 ease-snappy orb-float">Dispute</span>
            <span className="bg-black text-white font-mono text-[10px] uppercase font-bold px-3 py-1 rounded-full hover:scale-105 transition-transform duration-300 ease-snappy">Arbitration</span>
            <span className="bg-alpha-purple text-white font-mono text-[10px] uppercase font-bold px-3 py-1 rounded-full hover:scale-105 transition-transform duration-300 ease-snappy">Defi</span>
            <span className="bg-lime-green text-black font-mono text-[10px] uppercase font-bold px-3 py-1 rounded-full hover:scale-105 transition-transform duration-300 ease-snappy">Protocol</span>
          </div>
          <div className="w-full md:w-3/4">
            <h2 className="font-display text-4xl md:text-5xl uppercase leading-none tracking-tight mb-4 text-black">
              ALPHA COURT&reg; BRINGS TOGETHER <br />
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500 text-white text-sm mr-1 hover:scale-110 transition-transform duration-300 ease-snappy orb-float">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" fillRule="evenodd"></path></svg>
              </span> CLAIMANTS,
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-orange-500 text-white text-sm mx-1 hover:scale-110 transition-transform duration-300 ease-snappy">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              </span> CHALLENGERS,
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-lime-green text-black text-sm mx-1 hover:scale-110 transition-transform duration-300 ease-snappy">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              </span> VALIDATORS, <br />
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-500 text-white text-sm mr-1 hover:scale-110 transition-transform duration-300 ease-snappy">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              </span> PROTOCOLS, AND
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-alpha-purple text-white text-sm mx-1 hover:scale-110 transition-transform duration-300 ease-snappy">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"></path></svg>
              </span> COMMUNITIES
            </h2>
            <p className="font-display text-4xl md:text-5xl uppercase leading-none tracking-tight text-gray-800 opacity-60">
              FOR DECENTRALIZED RESOLUTION,<br />
              ARBITRATION, AND VERDICT EXECUTION.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-black-layer text-white py-12 px-8">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-8 text-center font-display uppercase">
          <div className="hover:-translate-y-2 transition-transform duration-300 ease-snappy stat-pop">
            <div className="text-6xl md:text-8xl tracking-tighter">{docketCount}</div>
            <div className="text-xs font-mono tracking-widest text-gray-400 mt-2">Dockets on chain</div>
          </div>
          <div className="hover:-translate-y-2 transition-transform duration-300 ease-snappy">
            <div className="text-6xl md:text-8xl tracking-tighter">{openCount}</div>
            <div className="text-xs font-mono tracking-widest text-gray-400 mt-2">Open books</div>
          </div>
          <div className="hover:-translate-y-2 transition-transform duration-300 ease-snappy stat-pop" style={{ animationDelay: "0.4s" }}>
            <div className="text-6xl md:text-8xl tracking-tighter">{settledCount}</div>
            <div className="text-xs font-mono tracking-widest text-gray-400 mt-2">Settled verdicts</div>
          </div>
          <div className="hover:-translate-y-2 transition-transform duration-300 ease-snappy">
            <div className="text-6xl md:text-8xl tracking-tighter">{formatGen(genInPlay)}</div>
            <div className="text-xs font-mono tracking-widest text-gray-400 mt-2">GEN in play</div>
          </div>
        </div>
      </section>

      <section className="bg-gray-layer py-20 px-8 relative overflow-hidden">
        <div className="max-w-7xl mx-auto flex justify-between items-end mb-16 relative z-10">
          <div>
            <h2 className="font-display text-5xl md:text-7xl uppercase leading-none tracking-tight">
              {docketCount} ACTIVE
            </h2>
            <h3 className="font-display text-3xl md:text-5xl uppercase text-black">DOCKETS</h3>
          </div>
          <div className="text-right flex flex-col items-end">
            <Link href="/browse-cases" className="bg-black text-white text-xs font-mono font-bold px-4 py-2 rounded-full flex items-center gap-2 mb-2 hover:bg-alpha-purple hover:scale-105 transition-all duration-300 ease-snappy glow-purple">
              VIEW ALL
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
              </svg>
            </Link>
            {stats.nextDeadline ? <LandingClock targetIso={stats.nextDeadline.deadline} tone="light" /> : null}
          </div>
        </div>
        <LiveCarousel claims={claims.slice(0, 8)} />
      </section>

      <section className="bg-white-layer py-20 px-8 border-t border-gray-200 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="font-display text-5xl md:text-7xl uppercase leading-none tracking-tight">COMMUNITY CONSENSUS</h2>
              <h3 className="font-display text-3xl md:text-5xl uppercase text-black">LIVE BOOK</h3>
            </div>
            <Link href="/leaderboard" className="hidden md:inline-flex bg-black text-white text-xs font-mono font-bold px-4 py-2 rounded-full items-center gap-2 hover:bg-lime-green hover:text-black hover:scale-105 transition-all duration-300 ease-snappy glow-lime">
              VIEW LEADERBOARD
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
              </svg>
            </Link>
          </div>
          <div className="space-y-6 max-w-5xl">
            <div className="relative w-full h-24 bg-gray-100 rounded-r-full overflow-hidden opacity-0 animate-fade-in-up stagger-1">
              <div className="absolute top-0 left-0 h-full bg-alpha-purple rounded-r-full flex items-center justify-end px-8 glow-purple" style={{ width: `${Math.max(18, forPct)}%` }}>
                <span className="font-mono text-white text-sm font-bold opacity-80">FOR</span>
              </div>
            </div>
            <div className="relative w-full h-24 flex items-center gap-4 opacity-0 animate-fade-in-up stagger-2">
              <div className="relative flex-1 h-full bg-gray-100 rounded-r-full overflow-hidden">
                <div className="absolute top-0 left-0 h-full bg-lime-green rounded-r-full flex items-center justify-end px-8 glow-lime" style={{ width: `${Math.max(18, againstPct)}%` }}>
                  <span className="font-mono text-black text-sm font-bold opacity-60">AGAINST</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white-layer py-20 px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-start mb-12">
            <h2 className="font-display text-5xl md:text-7xl uppercase leading-none tracking-tight max-w-xl">THE ROAD TO THE VERDICT</h2>
            <div className="text-right font-display text-3xl uppercase leading-none">
              OPEN<br />
              <span className="text-gray-400">LOCK</span><br />
              <span className="text-gray-400">RESOLVE</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2 bg-alpha-purple rounded-3xl p-6 text-white relative flex flex-col justify-between min-h-[220px] hover:scale-[1.02] transition-transform duration-300 ease-snappy glow-purple">
              <div>
                <h4 className="font-display text-3xl uppercase leading-none mb-1">CLAIM POSTED</h4>
                <span className="font-mono text-[10px] uppercase tracking-widest opacity-80">STATE OPEN</span>
              </div>
              <p className="font-sans text-sm">File a price, relative, or fundamentals claim. Others stake 1-10 GEN for or against until the deadline.</p>
            </div>
            <div className="bg-gray-100 rounded-3xl p-6 flex flex-col justify-between min-h-[220px] hover:bg-gray-200 hover:-translate-y-1 transition-all duration-300 ease-snappy">
              <div>
                <h4 className="font-display text-2xl uppercase leading-none mb-1 text-black">EVIDENCE LOCKS</h4>
                <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">DEADLINE</span>
              </div>
              <p className="font-sans text-sm text-gray-700">Keeper or any caller freezes the Surf mark. Staking stops.</p>
            </div>
            <div className="bg-lime-green rounded-3xl p-6 flex flex-col justify-between min-h-[220px] hover:-translate-y-1 transition-all duration-300 ease-snappy glow-lime">
              <div>
                <h4 className="font-display text-2xl uppercase leading-none mb-1 text-black">VERDICT</h4>
                <span className="font-mono text-[10px] uppercase tracking-widest text-black/60">HELD OR BROKEN</span>
              </div>
              <p className="font-sans text-sm">Winners take their stake plus a share of the losing pool.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-wavy py-32 px-8 text-center relative overflow-hidden bg-white-layer">
        <CastParade />
        <div className="relative z-10 max-w-3xl mx-auto flex flex-col items-center">
          <svg className="w-12 h-12 mb-6 text-black hover:scale-110 hover:text-alpha-purple transition-all duration-300 ease-snappy orb-float" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
            <line x1="12" x2="12" y1="22.08" y2="12"></line>
          </svg>
          <h2 className="font-display text-6xl md:text-8xl uppercase leading-[0.85] tracking-tighter text-black mb-8">
            BE PART OF THE <br />
            <span className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-alpha-purple text-white text-3xl align-middle mx-2 shadow-lg hover:scale-110 hover:rotate-12 transition-all duration-300 ease-snappy glow-purple">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"></path></svg>
            </span>
            COMMUNITY
          </h2>
          <Link href="/post-a-claim" className="bg-black text-white text-sm font-mono font-bold px-6 py-3 rounded-full flex items-center gap-3 hover:bg-alpha-purple hover:scale-105 transition-all duration-300 ease-snappy shadow-xl glow-purple">
            FILE A CLAIM
            <svg className="w-4 h-4 bg-white text-black rounded-full p-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
            </svg>
          </Link>
        </div>
      </section>

      <footer className="bg-alpha-purple text-white pt-20 pb-8 px-8 border-b-8 border-black relative overflow-hidden">
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-12 mb-20">
            <div className="col-span-1 md:col-span-3 hover:-translate-y-1 transition-transform duration-300 ease-snappy">
              <h2 className="font-display text-4xl uppercase leading-none tracking-tight">
                ALPHA<br />COURT<sup className="text-lg">&reg;</sup>
              </h2>
            </div>
            <div className="col-span-1 md:col-span-6 grid grid-cols-3 gap-4 font-mono text-[10px] uppercase font-bold tracking-widest">
              <div>
                <h4 className="text-white/50 mb-4">MAIN MENU</h4>
                <ul className="space-y-3">
                  <li><Link className="hover:text-black hover:pl-2 transition-all duration-300 ease-snappy block" href="/">Home</Link></li>
                  <li>
                    <Link className="hover:text-black hover:pl-2 transition-all duration-300 ease-snappy block" href="/browse-cases">
                      Dockets <span className="bg-lime-green text-black px-1 rounded ml-1 animate-pulse-fast inline-block">Live</span>
                    </Link>
                  </li>
                  <li><Link className="hover:text-black hover:pl-2 transition-all duration-300 ease-snappy block" href="/leaderboard">Hall of Fame</Link></li>
                  <li><Link className="hover:text-black hover:pl-2 transition-all duration-300 ease-snappy block" href="/post-a-claim">Submission</Link></li>
                  <li><Link className="hover:text-black hover:pl-2 transition-all duration-300 ease-snappy block" href="/alpha-passport">Jury Profile</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="text-white/50 mb-4">WRITE</h4>
                <ul className="space-y-3">
                  <li><Link className="hover:text-black hover:pl-2 transition-all duration-300 ease-snappy block" href="/activity">Activity</Link></li>
                  <li><Link className="hover:text-black hover:pl-2 transition-all duration-300 ease-snappy block" href="/my-claims">My claims</Link></li>
                  <li><Link className="hover:text-black hover:pl-2 transition-all duration-300 ease-snappy block" href="/how-verdicts-work">How verdicts work</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="text-white/50 mb-4">ON CHAIN</h4>
                <ul className="space-y-3">
                  <li>{docketCount} dockets</li>
                  <li>{openCount} open books</li>
                  <li>{formatGen(genInPlay)} GEN staked</li>
                </ul>
              </div>
            </div>
            <div className="col-span-1 md:col-span-3 text-right">
              <Link href="/browse-cases" className="bg-black text-white text-xs font-mono font-bold px-4 py-2 rounded-full inline-flex items-center gap-2 mb-6 hover:bg-lime-green hover:text-black hover:scale-105 transition-all duration-300 ease-snappy glow-lime">
                OPEN MARKETS
              </Link>
              {stats.nextDeadline ? <LandingClock targetIso={stats.nextDeadline.deadline} tone="purple" /> : null}
            </div>
          </div>
          <div className="flex flex-col md:flex-row justify-between items-end border-t border-white/20 pt-8">
            <div className="flex flex-wrap gap-2 mb-4 md:mb-0">
              <span className="bg-black text-white font-mono text-[10px] uppercase font-bold px-3 py-1.5 rounded-full hover:-translate-y-1 transition-transform duration-300 ease-snappy">Price</span>
              <span className="bg-white text-black font-mono text-[10px] uppercase font-bold px-3 py-1.5 rounded-full hover:-translate-y-1 transition-transform duration-300 ease-snappy">Relative</span>
              <span className="bg-lime-green text-black font-mono text-[10px] uppercase font-bold px-3 py-1.5 rounded-full hover:-translate-y-1 transition-transform duration-300 ease-snappy glow-lime">Fundamentals</span>
            </div>
            <div className="font-mono text-[10px] text-white/50 uppercase tracking-widest text-center flex-1">2026. ALL RIGHTS RESERVED.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
