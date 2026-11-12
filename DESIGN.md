# Design

**Visual direction (from 2026-11-12):** warm and editorial, in the spirit of tasteskill.dev: a dark brown hero that glows into amber, cream pages, very large tight headlines, real product UI in frames, and scroll-driven 3D moments. This replaced the dark Figma look for the website.

**Content and structure** still come from the Figma file **VTC Tracker / Website mockups**
https://www.figma.com/design/sBFmzBcLCYHD8lwayT4Xzq

- Page **Website**: Landing, Driver dashboard, Company page, Live map, Events; states (new driver, empty live map); mobile frames at 390 px. Use it for what each screen shows and says, not for colours or type.
- Page **Tracker app**: Setup, Live job, History, Settings, Tray popover. The tracker app has not been restyled yet.

## Tokens

Defined in `packages/ui/src/styles/globals.css`.

| Token                     | Value                    | Use                                                                           |
| ------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `--background`            | `#F6F1E9`                | Cream page background                                                         |
| `--card`                  | `#FFFDF9`                | Cards and panels                                                              |
| `--secondary` / `--muted` | `#EFE7DB`                | Pills, inactive tabs, skeletons, date tiles                                   |
| `--border`                | `#E3D9CB`                | All 1px borders and dividers                                                  |
| `--foreground`            | `#1D1712`                | Text (warm near-black)                                                        |
| `--muted-foreground`      | `#675D54`                | Secondary text                                                                |
| `--primary`               | `#F5A524`                | Amber: primary buttons, progress, the selected item. Text on it is `#1A1204`. |
| `--signal-ink`            | `#9A5200`                | Amber as text or icons on cream (amber itself fails contrast there)           |
| `--night` / `--night-2`   | `#120C07` / `#2A1709`    | Dark hero, closing band, dark visual panels                                   |
| `--success`               | `#1E7D4B` (bg `#E3F2E8`) | Delivered, connected, verified                                                |
| `--destructive`           | `#C23B37`                | Flagged jobs, failed checks                                                   |
| `--game-ets2`             | `#2F63C4` (bg `#E4ECFA`) | ETS2 badge                                                                    |
| `--game-ats`              | `#137A6D` (bg `#DEF3EF`) | ATS badge                                                                     |
| `--discord`               | `#5865F2`                | Only the Discord login button on `/login`                                     |

Gradients: only warm ones (brown to amber to cream) on the hero, the closing band and visual panels. Never purple, lavender or violet. Rank pills are neutral (`--secondary`).

## Light and dark

Both themes use the same tokens; `.dark` on `<html>` swaps their values (`packages/ui/src/styles/globals.css`).

- **Default:** follow the visitor's OS setting. The sun/moon button in the nav switches it, and the choice is saved in `localStorage` (`tacho-theme`).
- **No flash:** `THEME_SCRIPT` (`apps/web/src/lib/theme.ts`) runs in `<head>` before the page paints and sets the class. `<html>` has `suppressHydrationWarning` because of that.
- **Dark values:** page `#120D0A`, cards `#1B1511`, borders `#33291F`, text `#F3ECE2`, secondary text `#A99D8F`, amber text `#F5B04A`. Amber buttons stay `#F5A524`.
- **Always dark in both themes:** the hero, the nav pill, the closing band, the live map panel and the tracker preview.
- **Never hard-code a light colour** for a surface that sits on the page. Use a token (`--panel-from`, `--panel-to`, `--panel-glow`, `--row-highlight`, `--float-shadow`, `--drum-idle`, `--discord-chip-*`, `--hero-fade`) so both themes work.
- Screenshot both themes when checking UI changes (Playwright `colorScheme: "dark"`).

## Type

- **Archivo Variable** for headings (`font-display`, weight 800, tracking -0.025em, `text-wrap: balance`). It has a width axis; the hero uses `font-stretch: 92%`.
- **Public Sans Variable** for everything else.
- Numbers in tables, stats and leaderboards use the `tabular` class.
- Headline sizes are fluid: hero `clamp(2.6rem, 7vw, 5.6rem)`, section `clamp(2rem, 4.5vw, 3.5rem)`.

## Shape and spacing

- Radius: 8 buttons and inputs, 16 cards and panels, 24 big section panels, pills fully round.
- The nav is a floating dark pill, fixed at the top on every page; pages start with `pt-28`.
- Shadows only under floating UI previews (warm, `rgba(90,52,10,0.14)`), never on regular cards.

## Components and rules

- Icons: lucide-react, stroke 2. Brand marks (Discord) as inline SVG, only on Discord buttons. Never unicode glyphs as icons.
- Product previews are real HTML built from our UI, with example data from the Figma file (`apps/web/src/components/landing/sample-data.ts`). Never fake usage numbers, reviews or testimonials.
- No eyebrow labels above headings, no gradient text, no glass cards, no coloured side borders except the active step marker.
- One primary (amber) action per view.
- Every list and screen has empty, loading (skeleton rows, never a spinner in content) and error states.
- Forms have visible labels above fields; placeholders are examples.

## Motion

Library: `motion` (`motion/react`).

- **Hero:** text enters once on load (fade up, 0.6 s, staggered 0.1 s). The product frame starts tipped back (`rotateX` 26°) and stands up as it scrolls into view.
- **Route drum** (`route-drum.tsx`): a pinned section; deliveries sit on a 3D cylinder and roll past with the scroll, and the row facing you turns amber.
- **How it works** (`how-it-works.tsx`): pinned on tablet and up; the step list drives the visual. On phones it's a plain stack.
- **Feature rows:** fade up once when they enter the viewport.
- Buttons scale to 0.97 on press. UI transitions 150–250 ms, ease-out, transform and opacity only.
- **Reduced motion:** `MotionConfig reducedMotion="user"` at the root, plus `useReducedMotionSafe()` for scroll-linked effects. Pinned sections become plain lists. The hook returns `false` until after hydration so server and client HTML match.

## Verify

After UI changes, screenshot with Playwright at 1440, 768 and 390 px wide while scrolling, and once with `reducedMotion: "reduce"`. Check contrast (4.5:1 body text), focus rings, tabular numbers, no horizontal overflow, and no console or hydration errors.
