---
name: Alpha Court Design System
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
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
typography:
  display-xl:
    fontFamily: Anton
    fontSize: 120px
    fontWeight: '400'
    lineHeight: 100px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Anton
    fontSize: 64px
    fontWeight: '400'
    lineHeight: 64px
  headline-lg-mobile:
    fontFamily: Anton
    fontSize: 40px
    fontWeight: '400'
    lineHeight: 40px
  data-lg:
    fontFamily: JetBrains Mono
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.04em
  body-md:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.1em
spacing:
  unit: 8px
  container-max: 1440px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
  section-gap: 120px
---

## Brand & Style

The design system for this platform is built on a foundation of **High-Contrast, Bold, and Energetic** aesthetics. It is designed to evoke the high-stakes, rapid-response nature of crypto-legal claims while maintaining an authoritative and credible presence. The visual language is "numbers-forward," prioritizing raw data, countdown timers, and live trust signals to create an environment of transparency and urgency.

The brand personality is uncompromising and judicial, yet digitally native. It borrows the aggressive, large-scale typography of high-tier award ceremonies and sports broadcasts to elevate public claims into a spectacle of "on-chain justice." The "Live data via Surf" signal is integrated as a permanent, high-visibility trust anchor across all primary views.

## Colors

The palette uses a high-tension contrast between deep purples and electric lime. 
- **Primary (Electric Purple):** Used for primary actions, branding elements, and progress container backgrounds.
- **Secondary (Lime Green):** Reserved for accent signals, "live" indicators, and high-priority success states.
- **Neutral (Ink Black & Deep Grey):** The foundation of the UI. Backgrounds are not pure black but a deep charcoal to allow for subtle layering.
- **Surface Tiers:** Use varying shades of dark grey to define cards and modular sections without relying on traditional shadows.

## Typography

Typography is the primary driver of the system's authority. 
- **Headlines:** Use **Anton** for massive, impactful headings. These should be set with tight leading and negative letter spacing to mimic the condensed, powerful feel of the reference imagery.
- **Data & Numbers:** Use **JetBrains Mono** for all numerical data, hash addresses, and countdowns. This reinforces the "tech-first" and "immutable" nature of the court.
- **Interface & Labels:** **Space Grotesk** provides a clean, geometric contrast for instructional text and form labels, ensuring high legibility amidst the bold display elements.

## Layout & Spacing

The design system utilizes a **Fixed Grid** on desktop and a **Fluid Grid** on mobile.
- **Grid Model:** 12-column layout with generous 24px gutters. 
- **Sectioning:** Distinct horizontal bands separate content blocks, often using background color shifts (e.g., a purple band followed by a black band) to define the information hierarchy.
- **Alignment:** All text and components are strictly aligned to the grid. Use "Massive Margins" (64px+) on desktop to create a premium, editorial feel that allows the oversized typography to breathe.
- **Responsiveness:** On mobile, font sizes scale aggressively (using `headline-lg-mobile`) and columns collapse to a single stack, maintaining the 20px safe margin.

## Elevation & Depth

This system rejects soft shadows in favor of **Tonal Layers and Bold Borders**.
- **Stacking:** Depth is communicated through value shifts in the background. A secondary surface might be 5% lighter than the base background.
- **Outlines:** High-contrast 2px borders are used for interactive elements like cards and input fields.
- **The "Surf" Signal:** The "Live data via Surf" trust signal should appear as a floating, high-visibility pill or a fixed header element with a subtle glow or "pulse" animation to indicate real-time connectivity.

## Shapes

The shape language is **Sharp and Brutalist**. 
- **Radius:** All primary containers, buttons, and input fields use a 0px radius. This reinforces the "Court" metaphor—rigid, structured, and formal.
- **Exceptions:** Very specific "Live" indicators or "Status" chips may use a full pill-shape (radius: 100px) to provide a visual break and draw the eye to real-time data points.

## Components

- **Buttons:** Large, rectangular blocks. Primary buttons use the Lime Green background with Black text. Secondary buttons use an outline style with Purple or White text. Use a 45-degree arrow icon for external links or "submit" actions.
- **Progress Bars:** Thick, horizontal bars. The "filled" portion uses a gradient from Purple to Lime to visualize claim completion or voting status.
- **Countdowns:** Set in large JetBrains Mono. Use colon separators that blink to indicate an active process.
- **Cards:** Use 2px borders (White or Purple). Content inside cards should be numbers-first, with the largest font size reserved for the claim amount or vote count.
- **Live Signal:** A persistent UI component featuring the "Surf" logo and a pulsing Lime dot. This should be present in the top-right of all data-heavy views.
- **Data Lists:** Tables should have no vertical lines; use horizontal rules only. Every third row can be slightly tinted to aid horizontal scanning in data-dense court dockets.