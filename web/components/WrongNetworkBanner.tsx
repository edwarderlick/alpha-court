/**
 * Wrong-network banner, extracted verbatim from the top of the modal in
 * wallet_connect_pro_theme/code.html. Visual only — no real network
 * detection, per task scope.
 */
export function WrongNetworkBanner({ onSwitch }: { onSwitch?: () => void }) {
  return (
    <div className="bg-primary-container text-white px-6 py-4 flex items-center justify-between border-b-2 border-black relative z-10">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>
          warning
        </span>
        <div>
          <h3 className="font-label-mono-bold text-label-mono-bold text-white uppercase tracking-wider">
            Wrong Network Detected
          </h3>
          <p className="font-body-md text-[12px] text-white/90 mt-1">
            Please switch to GenVM Testnet to interact.
          </p>
        </div>
      </div>
      <button
        onClick={onSwitch}
        className="bg-black text-white font-label-mono-sm text-label-mono-sm px-4 py-2 rounded-full border-none hover:bg-white hover:text-black transition-colors uppercase tracking-widest shadow-xl"
      >
        Switch
      </button>
    </div>
  );
}
