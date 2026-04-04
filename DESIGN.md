# AOS Design Language

Read this file before building any UI. Follow it exactly.

## Philosophy

The qareen is a presence, not a dashboard. Warm, atmospheric, alive.
Content lives on a canvas — not in boxes. Chrome floats and disappears.
The interface feels like a space you inhabit, not a tool you operate.

**Guiding principles:**
- Warm over cold. Always. Every surface, every border, every shadow.
- Content-first. Generous whitespace, no decorative noise.
- Hierarchy through opacity, not separate color values.
- Minimal elevation. Borders over shadows.
- No permanent chrome. Content gets the screen. Chrome floats and overlays.

## Fonts

| Font | Use | Why |
|------|-----|-----|
| **Inter** (sans-serif) | Everything. Default for all UI, labels, body text, nav, controls. | Clean, functional, consistent. The base layer. |
| **EB Garamond** (serif) | Opt-in for reading surfaces: briefings, knowledge content, chat prose, vault notes. | Warmth and personality where the qareen speaks in paragraphs. |
| **Berkeley Mono** (mono) | Code, timestamps, counts. | |

```css
--font-sans:  "Inter Variable", "SF Pro Text", -apple-system, sans-serif;
--font-serif: "EB Garamond Variable", Georgia, serif;
--font-mono:  "Berkeley Mono", "SF Mono", ui-monospace, monospace;
```

Body defaults to sans. Apply `font-serif` explicitly where you want Garamond — never assume it's inherited.

## Color Tokens

Two themes: warm dark (default) and warm light. Both share the same token names — values swap via `[data-theme]` in CSS. Never cold. Never blue-tinted.

### Dark Theme (default)

The palette is warm dark brown.

### Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#0D0B09` | Deepest background |
| `bg-panel` | `#151210` | Panels, drawers |
| `bg-secondary` | `#1E1A16` | Elevated: inputs, cards |
| `bg-tertiary` | `#2A2520` | Hover surfaces, code blocks |
| `bg-quaternary` | `#3A3530` | Highest elevation |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `text` | `#FFFFFF` | Primary — headings, emphasis |
| `text-secondary` | `#E8E4DF` | Body text, descriptions |
| `text-tertiary` | `#9A9490` | Metadata, timestamps |
| `text-quaternary` | `#6B6560` | Placeholders, disabled |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `border` | `rgba(255, 245, 235, 0.06)` | Default dividers |
| `border-secondary` | `rgba(255, 245, 235, 0.10)` | Input borders, cards |
| `border-tertiary` | `rgba(255, 245, 235, 0.15)` | Strong emphasis |

Borders are cream-tinted, not white. `rgba(255, 245, 235, ...)` not `rgba(255, 255, 255, ...)`.

### Accent & Status

| Token | Value | Usage |
|-------|-------|-------|
| `accent` | `#D9730D` | Brand orange, active indicators |
| `accent-hover` | `#E8842A` | Hover state |
| `accent-muted` | `#1F1510` | Dark tinted bg behind accent elements |
| `accent-subtle` | `rgba(217,115,13,0.15)` | Faint accent wash |
| `green` | `#30D158` | Success, connected |
| `red` | `#FF453A` | Error, destructive |
| `yellow` | `#FFD60A` | Warning, pending |
| `blue` | `#0A84FF` | Info, links |
| `purple` | `#BF5AF2` | Special, agent |
| `teal` | `#64D2FF` | Highlights, secondary info |
| `orange` | `#FF9F0A` | Attention, medium priority |

### Muted Variants

Every status color has a `-muted` companion — a dark-tinted background for badges, tags, and status chips. Provides subtle context without visual noise.

| Token | Value | Used behind |
|-------|-------|-------------|
| `green-muted` | `#0D1F12` | Success badges |
| `red-muted` | `#1F0F0E` | Error indicators |
| `yellow-muted` | `#1C1A08` | Warning chips |
| `orange-muted` | `#1C1508` | Attention badges |
| `blue-muted` | `#0A1520` | Info backgrounds |
| `purple-muted` | `#1A1020` | Agent/special |
| `teal-muted` | `#0A1A20` | Highlight backgrounds |

In light mode, muted variants flip to light washes (e.g. `green-muted` → `#E8F5EE`).

### Tag Colors

9 color families for labels, categories, and pipeline stages. Each has a paired text + background token.

| Family | Text | Background |
|--------|------|------------|
| `tag-gray` | `#8E8E93` | `#2C2C2E` |
| `tag-green` | `#30D158` | `#12261A` |
| `tag-blue` | `#0A84FF` | `#0F1A2E` |
| `tag-purple` | `#BF5AF2` | `#1E1228` |
| `tag-red` | `#FF453A` | `#2E1210` |
| `tag-yellow` | `#FFD60A` | `#262010` |
| `tag-orange` | `#FF9F0A` | `#261A0A` |
| `tag-teal` | `#64D2FF` | `#102228` |
| `tag-pink` | `#FF375F` | `#28101A` |

Usage: `<span className="text-tag-blue bg-tag-blue-bg">label</span>`. Both values swap in light mode.

### Interaction

| Token | Value | Usage |
|-------|-------|-------|
| `hover` | `rgba(255, 245, 235, 0.05)` | Hover backgrounds |
| `active` | `rgba(255, 245, 235, 0.08)` | Active/pressed |
| `selected` | `rgba(255, 245, 235, 0.12)` | Selected items |

### Light Theme

Warm paper tones. Set via `data-theme="light"` on `<html>`. Stored in `localStorage` key `qareen-theme`.

| Token | Dark | Light |
|-------|------|-------|
| `bg` | `#0D0B09` | `#F7F4F0` |
| `bg-panel` | `#151210` | `#EFEBE4` |
| `bg-secondary` | `#1E1A16` | `#EAE5DD` |
| `bg-tertiary` | `#2A2520` | `#E3DDD5` |
| `text` | `#FFFFFF` | `#38322B` |
| `text-secondary` | `#E8E4DF` | `#5C554C` |
| `text-tertiary` | `#9A9490` | `#8A827A` |
| `accent` | `#D9730D` | `#C4660A` |
| `border` | `rgba(255,245,235,0.06)` | `rgba(56,50,43,0.07)` |

Light borders are brown-tinted, not gray. `rgba(56, 50, 43, ...)` — same warmth principle, inverted.

Status colors are darkened for paper readability (e.g. green `#30D158` → `#2D8A50`). Muted variants flip to light washes (e.g. `green-muted` `#0D1F12` → `#E8F5EE`).

**Rule:** Components reference token names, never raw hex. The theme swap handles everything. Glass, shadows, and interactions all have light variants in CSS.

## Glass Pill Pattern

Floating UI chrome uses translucent glass pills. Theme-aware via CSS variables.

```css
background: var(--glass-bg);           /* dark: rgba(30,26,22,0.60)  light: rgba(247,244,240,0.70) */
backdrop-filter: blur(12px);
border: 1px solid var(--glass-border); /* dark: warm cream alpha      light: warm brown alpha */
border-radius: 9999px;
box-shadow: var(--glass-shadow);
height: 32px;
```

**Never hardcode glass values inline.** Use `--glass-bg`, `--glass-border`, `--glass-shadow`. They swap with the theme.

Used for: navigation toggle, context bar, tab pills. Never for content containers.

## Navigation

No permanent sidebar or topbar. Navigation is a floating overlay.

**Collapsed (default):** Small glass pill at top-left. Shows: hamburger icon → current page icon → page name → connection dot. Always visible. `z-index: 320`.

**Expanded:** Drawer slides in from left ON TOP of content. Background gets `backdrop-blur-sm` overlay. Click outside, Escape, or click pill to close. Nav item selection auto-closes.

**Animation:** Slide in/out 180ms ease-out. Backdrop fades in sync.

Content always gets 100% screen width.

## Orb

The companion idle screen has a living presence: a WebGL orb (Three.js via react-three-fiber). GLSL shaders render orbital rings with Perlin noise, voice-reactive animation, and prayer-period color shifting. The orb is blurred (40-60px) as a full-screen background behind the companion UI.

**The orb lives on the companion screen only.** It is the qareen's visual heartbeat.

### Prayer-Period Ambient Tinting

The rest of the app absorbs the orb's color influence without rendering WebGL. A subtle radial gradient overlay on every page shifts with the current Islamic time period. A film grain texture (SVG `feTurbulence`) adds analog warmth.

**Implementation:** `usePrayerAmbient` hook → Layout renders two layers:
1. Radial gradient (two ellipses, 50% opacity, 60s CSS transition)
2. Grain overlay (SVG noise filter, 3% opacity, `mix-blend-mode: overlay`)

**Colors shift by Islamic prayer period:**

| Period | Vibe | Orb Colors | Ambient Tint |
|--------|------|------------|--------------|
| Last Third | Pre-dawn | `#2A1F4E` / `#4A3570` | Deep indigo |
| Fajr | Dawn prayer | `#5C3D7A` / `#8B5A6B` | Violet haze |
| Sunrise | Morning light | `#C4692A` / `#E8943D` | Warm amber glow |
| Duha | Morning energy | `#D9730D` / `#E8943D` | Golden warmth |
| Dhuhr | Midday | `#D4920F` / `#E8B84D` | Bright gold |
| Asr | Afternoon | `#C47020` / `#D9883A` | Mellow amber |
| Maghrib | Sunset | `#9A3E1A` / `#C45530` | Sunset red-brown |
| Isha | Night | `#3D2A1E` / `#6B4530` | Near-black warmth |

Prayer calculation via `adhan` library (ISNA method, Shafi'i Asr). Updates every 60 seconds.

## Context Bar

Glass pill centered at top of companion screen. Same vertical position as nav pill (`top: 12px`). Uses Inter (sans-serif). `text-[11px]`.

```
11:47 AM · Tue, Apr 1 · Duha · Dhuhr in 1h 28m · 14° Overcast
```

- Time: `text-secondary`, tabular-nums
- Date: `text-tertiary`
- Prayer period: `accent` color
- Countdown + weather: `text-tertiary`

Prayer via `adhan` library (local calculation). Weather via Open-Meteo (free, no key).

## Typography Scale

| Element | Font | Size | Weight | Line Height |
|---------|------|------|--------|-------------|
| Greeting | Garamond | 24px | 600 | 1.3 |
| Body / paragraphs | Garamond | 13px | 400 | 1.5 |
| Nav items | Inter | 12-13px | 450-590 | 1.3 |
| Labels | Inter | 13px | 510 | 1.4 |
| Buttons | Inter | 12-13px | 510 | — |
| Badges / tags | Inter | 11px | 510 | 1.2 |
| Captions | Inter | 11px | 400 | 1.45 |
| Overlines | Inter | 10px | 590 | 1.2 |
| Context bar | Inter | 11px | 450-510 | — |
| Mono / code | Mono | 12px | 400 | 1.5 |

## Spacing & Radius

- Border radius: `3-7px` for cards/inputs. `9999px` for pills only.
- Touch targets: `32px` min, `44px` on mobile.
- Base unit: `4px`. Multiples: 4, 8, 12, 16, 20, 24, 32, 48.

## Motion

| Duration | Usage |
|----------|-------|
| 80ms | Hover states, toggles |
| 150ms | Focus, buttons, tabs |
| 180ms | Sidebar open/close, overlays |
| 220ms | Panels, layout shifts |
| 350ms | Page transitions |

Easing: `cubic-bezier(0.25, 0.46, 0.45, 0.94)` for most transitions.

**Rule:** `requestAnimationFrame` for canvas/motion effects. CSS transitions for hover/state changes. If something animates in, it must animate out.

## Composition

**Centered.** Companion idle screen centers content vertically and horizontally on the aurora canvas. Text stays left-aligned within the centered block.

**Vertical flow.** Greeting → briefing → suggestion chips → recent sessions. Single centered column. No multi-column grids on the main screen.

## Rules

1. **Warm over cold.** Every surface, every border, every shadow.
2. **No stat dumps.** The qareen speaks in sentences, not metrics.
3. **Sentence case.** "Transcript" not "TRANSCRIPT". No all-caps except tiny overline labels.
4. **No generic empty states.** Context-specific guidance, not "No data available."
5. **Real names.** "Hisham" not "operator." Always resolve against data.
6. **Cursor pointer.** Every clickable element.
7. **Animate open AND close.** No instant unmount.
8. **No permanent chrome.** Chrome floats and overlays.
9. **Prayer-period awareness.** Orb, ambient tint, context bar, greeting reflect the current Islamic time period.
10. **No hardcoded colors.** Always reference design tokens.
11. **Inter everywhere, serif opt-in.** Default is sans. Apply `font-serif` only on reading surfaces.
12. **No redundant page titles.** The nav pill shows the page name. Don't repeat it as an h1. Start with content.
13. **Page backgrounds are transparent.** Layout owns the bg + ambient tint. Pages don't set `bg-bg` on their root div.
14. **Use glass variables.** Never hardcode glass rgba — use `--glass-bg`, `--glass-border`, `--glass-shadow`.
