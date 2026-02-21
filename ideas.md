# Grand Arena Scheme Card Tool — Design Ideas

## Response 1
<response>
<text>
**Design Movement:** Dark Fantasy Tactical — inspired by trading card game UIs (Hearthstone, Legends of Runeterra)

**Core Principles:**
- Deep dark backgrounds with glowing card borders that pulse on hover
- Card-centric layout where every element is framed like a physical card
- Hierarchy through luminosity: important elements glow, secondary elements recede

**Color Philosophy:**
- Base: Near-black navy (#0a0e1a) with subtle blue-purple gradient
- Accent: Electric gold (#f5c842) for owned cards, cool cyan (#00d4ff) for scheme highlights
- Danger/price: Warm amber (#ff8c42) for marketplace prices
- Emotional intent: Power, mystery, collectibility

**Layout Paradigm:**
- Screen 1: Full-bleed centered hero with animated particle background, wallet input floated center
- Screen 2: Asymmetric masonry grid of scheme cards with a sticky filter sidebar
- Screen 3: Left panel = selected scheme info + filters; right = scrollable champion card grid

**Signature Elements:**
- Holographic card shimmer effect on hover (CSS gradient animation)
- Glowing rarity borders (Basic=grey, Rare=blue, Epic=purple, Legendary=gold)
- Floating particle/star background on the hero screen

**Interaction Philosophy:**
- Cards "lift" on hover with scale + shadow + glow
- Smooth page transitions with slide-in from right
- Filter toggles have satisfying click animations

**Animation:**
- Card entrance: staggered fade-up with 50ms delay between cards
- Hover: scale(1.04) + box-shadow glow intensifies
- Page transitions: framer-motion slide

**Typography System:**
- Display: "Cinzel" (fantasy serif) for titles and scheme names
- Body: "Nunito" (rounded sans) for descriptions and stats
- Mono: system-mono for wallet addresses
</text>
<probability>0.07</probability>
</response>

## Response 2
<response>
<text>
**Design Movement:** Brutalist Arcade — raw, bold, game-inspired with chunky typography

**Core Principles:**
- High contrast black/yellow like a warning sign — bold and unapologetic
- Thick borders, heavy shadows, no rounded corners
- Information density over decoration

**Color Philosophy:**
- Background: Off-white (#f5f0e8) with black (#0d0d0d) text
- Primary accent: Arena yellow (#FFD600)
- Secondary: Deep red (#C0392B) for prices/alerts
- Emotional intent: Energy, competition, urgency

**Layout Paradigm:**
- Newspaper-style grid with varying column widths
- Oversized scheme card names as headlines
- Champion grid uses compact list view by default

**Signature Elements:**
- Thick 3px black borders on all cards
- Drop shadows that are solid black (not blurred)
- Uppercase bold labels everywhere

**Interaction Philosophy:**
- Instant, no-animation transitions (brutalist = no fluff)
- Hover states use color inversion

**Animation:**
- Minimal: only essential loading states

**Typography System:**
- Display: "Space Grotesk" bold/black weight
- Body: "Space Grotesk" regular
- Mono: "Space Mono" for addresses
</text>
<probability>0.05</probability>
</response>

## Response 3 — CHOSEN
<response>
<text>
**Design Movement:** Premium Dark Gaming Dashboard — polished, modern, with deep navy/slate tones and vibrant accent colors inspired by high-end esports platforms

**Core Principles:**
- Deep slate/navy dark theme that makes card artwork pop
- Glassmorphism panels with subtle frosted-glass backgrounds
- Vibrant accent colors that match the game's energy (gold, teal, purple)
- Clean information hierarchy with generous whitespace

**Color Philosophy:**
- Background: Deep navy-slate (#0f1629) → (#1a2035) gradient
- Card surfaces: Semi-transparent dark glass (rgba(255,255,255,0.05)) with subtle borders
- Primary accent: Vivid gold (#f0b429) for owned/highlighted elements
- Secondary accent: Electric teal (#00c9b1) for scheme selection
- Rarity colors: Basic=slate, Rare=sky-blue, Epic=violet, Legendary=amber
- Emotional intent: Premium, trustworthy, game-native

**Layout Paradigm:**
- Screen 1: Centered hero with animated gradient background, large wallet input with RON address format hint
- Screen 2: Full-width scheme card gallery in a 4-5 column responsive grid, cards show artwork prominently
- Screen 3: Fixed header showing selected scheme + filter bar; below = responsive champion card grid

**Signature Elements:**
- Card artwork fills most of the card face, name/rarity badge overlaid at bottom
- Subtle animated gradient border on selected/hovered cards
- Owned badge (green checkmark) vs price badge (amber) on champion cards

**Interaction Philosophy:**
- Smooth hover lifts with glow matching rarity color
- Filter pills that animate in/out
- Back navigation is always visible

**Animation:**
- Entrance: staggered card fade-up (40ms delay)
- Hover: translateY(-4px) + shadow + border glow
- Filter: smooth height transition

**Typography System:**
- Display: "Rajdhani" (condensed, techy) for headings and card names
- Body: "DM Sans" for descriptions and UI labels
- Mono: "JetBrains Mono" for wallet addresses
</text>
<probability>0.08</probability>
</response>

## Selected Design: Response 3 — Premium Dark Gaming Dashboard
