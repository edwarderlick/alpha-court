---
name: Alpha Court Cyber-Protocol
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#d4c0d7'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#9d8ba0'
  outline-variant: '#514255'
  surface-tint: '#ecb2ff'
  primary: '#ecb2ff'
  on-primary: '#520071'
  primary-container: '#bd00ff'
  on-primary-container: '#ffffff'
  inverse-primary: '#9900cf'
  secondary: '#ffffff'
  on-secondary: '#293500'
  secondary-container: '#c7f300'
  on-secondary-container: '#576c00'
  tertiary: '#c6c6c7'
  on-tertiary: '#2f3131'
  tertiary-container: '#757676'
  on-tertiary-container: '#ffffff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#f8d8ff'
  primary-fixed-dim: '#ecb2ff'
  on-primary-fixed: '#320047'
  on-primary-fixed-variant: '#74009f'
  secondary-fixed: '#c7f300'
  secondary-fixed-dim: '#aed500'
  on-secondary-fixed: '#171e00'
  on-secondary-fixed-variant: '#3d4d00'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
  dispute-red: '#ef4444'
  arbitration-orange: '#f97316'
  execution-blue: '#3b82f6'
  surface-gray: '#27272a'
  surface-light: '#f4f4f5'
typography:
  display-hero:
    fontFamily: Anton
    fontSize: clamp(5rem, 20vw, 16rem)
    fontWeight: '400'
    lineHeight: '0.8'
    letterSpacing: -0.05em
  display-lg:
    fontFamily: Anton
    fontSize: 72px
    fontWeight: '400'
    lineHeight: '1.0'
    letterSpacing: -0.02em
  display-md:
    fontFamily: Anton
    fontSize: 48px
    fontWeight: '400'
    lineHeight: '1.0'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.5'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-mono-bold:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.2em
  label-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '700'
    lineHeight: '1.0'
    letterSpacing: 0.1em
  display-hero-mobile:
    fontFamily: Anton
    fontSize: 4rem
    fontWeight: '400'
    lineHeight: '0.9'
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  base: 4px
  gutter: 32px
  section-padding: 80px
  card-gap: 16px
  margin-safe: 32px
---

## Brand & Style
The brand is a high-stakes, decentralized legal protocol that merges "Cyberpunk Brutalism" with "Technocratic Authority." It evokes a sense of urgency, digital permanence, and high-tech friction. The target audience is Web3 power users, validators, and protocol developers who demand transparency and industrial-strength reliability.

The design style is **Neo-Brutalist / Cyberpunk**. It utilizes high-contrast color pairings (Purple/Lime), massive display typography, and intentional digital artifacts like scanlines, glitch effects, and "shader" backgrounds. The aesthetic is raw and functional yet polished with high-fidelity glow effects and snappy, physics-based transitions.

## Colors
The palette is built on a "Total Dark" foundation using `neutral-131313`, punctuated by two high-visibility neon accents: **Alpha Purple** for primary actions and brand identity, and **Lime Green** for status indicators, "live" data, and secondary buttons.

- **Primary (Purple):** Used for key branding elements, featured cards, and interactive hover states.
- **Secondary (Lime):** Reserved for "positive" actions (Vote, Stake), live indicators, and critical data highlights.
- **Semantic Accents:** Red is used strictly for "Disputes," Orange for "Challengers," and Blue for "Protocols" to categorize the legal narrative.
- **Glass Layers:** Backgrounds use high-opacity overlays (80-90%) with heavy backdrop blurs (10px) to maintain legibility over the animated shader background.

## Typography
The system uses a tri-font hierarchy to communicate scale, information, and technicality.

1.  **Display (Anton):** Used for massive, all-caps headlines. It should be used with tight tracking and often paired with "text-outline" effects to create depth without overwhelming the layout.
2.  **Monospaced (JetBrains Mono):** The "Data Layer." Used for all labels, countdowns, statistics, and metadata. It reinforces the "code-as-law" theme.
3.  **Sans (Inter):** The "Narrative Layer." Used for body text and descriptive paragraphs where readability is paramount.

**Styling Note:** Almost all text in the system—except for body paragraphs—should be set in **UPPERCASE**.

## Layout & Spacing
The layout follows a **Fluid Neo-Brutalist Grid**. Elements are often slightly rotated (1-2 degrees) or staggered to break the standard web grid and create a sense of dynamic "glitch."

- **Grid:** Use a 12-column layout for desktop with large 32px gutters.
- **Sectioning:** High vertical padding (80px+) separates narrative blocks, often defined by 2px solid borders in neutral tones.
- **Staggering:** Items in lists or carousels should use staggered entrance animations (0.1s increments) to emphasize the vertical hierarchy of the protocol.
- **Responsiveness:** On mobile, massive display fonts scale down to `4rem`, and grid-based layouts (like the Road to Verdict) collapse into a single-column vertical timeline.

## Elevation & Depth
Depth is not created through realistic shadows but through **Light Emission (Glow)** and **Layered Blurs**.

- **Glow Effects:** Interactive elements in Primary Purple or Lime Green use a double-layered box-shadow (15px and 30px) in the same hue with 0.3-0.5 opacity to simulate a neon light source.
- **Translucency:** Background layers use `backdrop-filter: blur(10px)` to sit "above" the global animated shader.
- **Outlines:** Use 1px or 2px "Text Outlines" for background typography to create a sense of skeletal structure.
- **Visual Friction:** Use scanline overlays (4px repeating gradients) on hero sections to provide a tactile, CRT-monitor texture.

## Shapes
The shape language is a mix of **Organic Curves** and **Geometric Hard Cuts**.

- **Containers:** Standard cards and containers use a generous `3rem` (Pill-shaped/rounded-3xl) radius to offset the aggressive typography.
- **Clipped Geometry:** High-priority "Featured" elements (like the center carousel card) use a **Hexagonal Clip-path** to signify a special "Protocol" status.
- **Interactive Elements:** Buttons and tags are always fully pill-shaped.
- **Borders:** Dashed 2px borders are used for "empty" or "placeholder" states to maintain the industrial blueprint aesthetic.

## Components
- **Buttons (Primary):** Pill-shaped, black background, white text. On hover, they transform to Alpha Purple or Lime Green and expand slightly (scale-105) with a matching glow.
- **Buttons (Action):** Circular buttons containing icons, often with a "tilt" animation on hover.
- **Chips/Tags:** Small pill-shaped badges with `label-mono-sm` text. Background colors are category-specific (Red for Dispute, Purple for Defi).
- **Progress Bars:** Thick (24px+ height) bars with fully rounded ends. The "fill" should have a neon glow and include a mono-label inside the fill area.
- **Cards (Event):** Large rounded-3xl containers. Use internal vertical flex layouts with display-md typography for dates and mono-labels for categories.
- **Glitch Text:** Special component for "Display Hero" roles that uses CSS pseudo-elements (`::before/::after`) to create a vibrating RGB-split effect.