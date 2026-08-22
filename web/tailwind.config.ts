import type { Config } from "tailwindcss";

// Lifted verbatim from the Stitch `code.html` exports. Every "app shell"
// screen (browse_cases, case_detail, activity_feed, my_claims, appeal_flow,
// alpha_passport, wallet_connect, how_verdicts_work, shared_states,
// post_a_claim step 1 & 2) ships the exact same colors/borderRadius/spacing/
// fontFamily/fontSize block, so that block is used verbatim below as the
// majority convention.
//
// The landing page (alpha_court_pro_landing_enhanced) and the leaderboard
// (leaderboard_reputation_rankings_vibrant_v2) are a separate design family:
// they ship their OWN isolated, much smaller config (colors: black/
// alpha-purple/lime-green/gray-light/gray-dark; fontFamily: display/mono/
// sans) plus the pulse-fast/fade-in-up/glitch animation block referenced in
// the brief. Their color names are added below as aliases pointing at the
// identical hex values already present in the app-shell palette, so no
// value is duplicated or invented.
//
// Known, flagged deviations from merging N independently-authored configs
// into one (see final report for details, not silently resolved):
//  - landing's own config overrides `tracking-widest` to 0.25em and
//    `borderRadius.xl` is unset there (falls back to Tailwind default
//    0.75rem). The app-shell majority overrides `borderRadius.xl` to 3rem
//    and never touches tracking-widest (default 0.1em). Since 11+ screens
//    depend on the app-shell values and only a handful of low-visibility
//    landing elements use the conflicting keys, the app-shell values win
//    globally here. Effect on landing: one small blurred/faded decorative
//    carousel card renders with a larger corner radius than the static
//    export, and nav/footer uppercase labels track slightly tighter
//    (0.1em vs. the 0.25em authored in isolation).
//  - leaderboard_reputation_rankings_vibrant_v2 additionally defines its
//    OWN unique borderRadius scale (DEFAULT 0.25rem/lg 0.5rem/xl 0.75rem)
//    matching neither the app-shell nor the landing page. Its JSX never
//    actually uses bare `rounded`/`rounded-lg`/`rounded-xl` classes (it
//    uses `rounded-full`, `rounded-xl`/`rounded-2xl` only on a couple of
//    elements where the value coincides with Tailwind defaults), so this
//    orphaned override is dropped rather than merged.
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "on-tertiary": "#2f3131",
        "primary-container": "#bd00ff",
        "error-container": "#93000a",
        "inverse-primary": "#9900cf",
        "surface-gray": "#27272a",
        surface: "#131313",
        "tertiary-container": "#757676",
        "on-secondary-fixed-variant": "#3d4d00",
        "on-tertiary-container": "#ffffff",
        "surface-container-highest": "#353534",
        "on-primary-fixed": "#320047",
        secondary: "#ffffff",
        "on-secondary-fixed": "#171e00",
        "surface-dim": "#131313",
        tertiary: "#c6c6c7",
        "arbitration-orange": "#f97316",
        "on-secondary": "#293500",
        "on-surface-variant": "#d4c0d7",
        "secondary-fixed": "#c7f300",
        "inverse-surface": "#e5e2e1",
        "tertiary-fixed": "#e2e2e2",
        "surface-tint": "#ecb2ff",
        "inverse-on-surface": "#313030",
        "on-secondary-container": "#576c00",
        background: "#131313",
        "surface-bright": "#393939",
        "on-tertiary-fixed": "#1a1c1c",
        primary: "#ecb2ff",
        outline: "#9d8ba0",
        "tertiary-fixed-dim": "#c6c6c7",
        "primary-fixed-dim": "#ecb2ff",
        "surface-container-low": "#1c1b1b",
        "secondary-container": "#c7f300",
        "dispute-red": "#ef4444",
        "on-error-container": "#ffdad6",
        "surface-light": "#f4f4f5",
        "execution-blue": "#3b82f6",
        "on-primary-container": "#ffffff",
        "primary-fixed": "#f8d8ff",
        "secondary-fixed-dim": "#aed500",
        "on-tertiary-fixed-variant": "#454747",
        "surface-container-lowest": "#0e0e0e",
        "surface-container": "#201f1f",
        "on-primary-fixed-variant": "#74009f",
        error: "#ffb4ab",
        "surface-container-high": "#2a2a2a",
        "on-error": "#690005",
        "on-background": "#e5e2e1",
        "on-surface": "#e5e2e1",
        "outline-variant": "#514255",
        "surface-variant": "#353534",
        "on-primary": "#520071",
        // Aliases used only by the landing page / leaderboard family —
        // same values as above, different class names in those exports.
        black: "#131313",
        "alpha-purple": "#bd00ff",
        "lime-green": "#c7f300",
        "gray-light": "#f4f4f5",
        "gray-dark": "#27272a",
      },
      borderRadius: {
        DEFAULT: "1rem",
        lg: "2rem",
        xl: "3rem",
        full: "9999px",
      },
      spacing: {
        base: "4px",
        gutter: "32px",
        "margin-safe": "32px",
        "section-padding": "80px",
        "card-gap": "16px",
        // Used only by leaderboard_reputation_rankings_vibrant_v2.
        "container-max": "1440px",
        "margin-mobile": "20px",
        "margin-desktop": "64px",
        unit: "8px",
        "section-gap": "120px",
      },
      fontFamily: {
        "display-hero-mobile": ["Anton"],
        "display-lg": ["Anton"],
        "label-mono-sm": ["JetBrains Mono"],
        "display-md": ["Anton"],
        "display-hero": ["Anton"],
        "body-md": ["Inter"],
        "body-lg": ["Inter"],
        "label-mono-bold": ["JetBrains Mono"],
        "headline-lg": ["Anton"],
        "headline-lg-mobile": ["Anton"],
        "label-caps": ["JetBrains Mono"],
        "trust-signal": ["JetBrains Mono"],
        // landing page / leaderboard family
        display: ["Anton", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        sans: ["Inter", "sans-serif"],
      },
      fontSize: {
        "display-hero-mobile": ["4rem", { lineHeight: "0.9", fontWeight: "400" }],
        "display-lg": [
          "72px",
          { lineHeight: "1.0", letterSpacing: "-0.02em", fontWeight: "400" },
        ],
        "label-mono-sm": [
          "10px",
          { lineHeight: "1.0", letterSpacing: "0.1em", fontWeight: "700" },
        ],
        "display-md": ["48px", { lineHeight: "1.0", fontWeight: "400" }],
        "display-hero": [
          "clamp(5rem, 20vw, 16rem)",
          { lineHeight: "0.8", letterSpacing: "-0.05em", fontWeight: "400" },
        ],
        "body-md": ["16px", { lineHeight: "1.5", fontWeight: "400" }],
        "body-lg": ["18px", { lineHeight: "1.5", fontWeight: "600" }],
        "label-mono-bold": [
          "14px",
          { lineHeight: "1.2", letterSpacing: "0.2em", fontWeight: "700" },
        ],
        "headline-lg": [
          "64px",
          { lineHeight: "64px", letterSpacing: "0.01em", fontWeight: "400" },
        ],
        "headline-lg-mobile": ["40px", { lineHeight: "40px", fontWeight: "400" }],
        "label-caps": [
          "12px",
          { lineHeight: "16px", letterSpacing: "0.1em", fontWeight: "700" },
        ],
        "trust-signal": ["14px", { lineHeight: "20px", fontWeight: "500" }],
      },
      letterSpacing: {
        // "tightest" is unique to the landing page and does not collide
        // with any app-shell key, so it is safe to merge as-is.
        tightest: "-.075em",
      },
      // Custom animations from alpha_court_pro_landing_enhanced — the
      // brief explicitly calls these out (pulse-fast / fade-in-up /
      // glitch) as ones that must actually be wired to elements, not just
      // present in config.
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(40px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        glitch: {
          "2%, 64%": { transform: "translate(2px,0) skew(0deg)" },
          "4%, 60%": { transform: "translate(-2px,0) skew(0deg)" },
          "62%": { transform: "translate(0,0) skew(5deg)" },
        },
      },
      animation: {
        "pulse-fast": "pulse 0.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in-up": "fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        glitch: "glitch 1s linear infinite",
      },
      transitionTimingFunction: {
        snappy: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("@tailwindcss/forms"), require("@tailwindcss/container-queries")],
};

export default config;
