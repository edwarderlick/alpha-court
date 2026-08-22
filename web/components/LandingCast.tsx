"use client";

const CAST = [
  { src: "/cast/judge.jpg", name: "judge", label: "Judge" },
  { src: "/cast/claimant.jpg", name: "claimant", label: "Claimant" },
  { src: "/cast/challenger.jpg", name: "challenger", label: "Challenger" },
  { src: "/cast/validator.jpg", name: "validator", label: "Validator" },
] as const;

export function LandingCast() {
  return (
    <div className="landing-cast" aria-hidden>
      {CAST.map((c) => (
        <img key={c.name} src={c.src} alt="" className={`cast-fig cast-${c.name}`} />
      ))}
      <img src="/cast/claimant.jpg" alt="" className="cast-fig cast-claimant cast-ghost cast-ghost-a" />
      <img src="/cast/claimant.jpg" alt="" className="cast-fig cast-claimant cast-ghost cast-ghost-b" />
    </div>
  );
}

export function CastParade() {
  return (
    <div className="cast-parade" aria-hidden>
      <div className="cast-parade-track">
        {[...CAST, ...CAST, ...CAST].map((c, i) => (
          <img key={`${c.name}-${i}`} src={c.src} alt="" className="cast-parade-fig" />
        ))}
      </div>
    </div>
  );
}
