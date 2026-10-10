# UI flow plan

Historical design notes for the merged UI workstream. The branch is retired;
current workstream ownership is in AGENTS.md. No shared contracts changed.

## Research notes

Reviewed the App Store listings and screenshots of Google (Lens), PictureThis,
Vivino, Adobe Scan, CamScanner and Amazon Shopping. Common patterns:

- **Camera first.** The app opens straight into a full-bleed, dark viewfinder.
  Almost no copy, just a hint like "Point at a product".
- **One thumb zone.** A large round shutter sits bottom-center, gallery on the
  left, a secondary control on the right. Mode/option chips sit just above.
- **Corner brackets** frame the target instead of a dashed drop zone (Vivino,
  Lens).
- **Visible "thinking".** Lens sprinkles shimmering dots over the frozen frame;
  scanners sweep a line across the page. The photo stays on screen while work
  happens.
- **Results as a bottom sheet.** The photo remains at the top and a rounded
  sheet slides up over it (Lens, PictureThis). The answer comes first: name,
  key chip/rating, then details, organised by tabs or sections.
- **Floating chips** carry key numbers (Vivino's rating bubble), not paragraphs.

## Flow

```
 ┌──────────┐  capture / pick   ┌──────────┐  response   ┌──────────────┐
 │  Camera  │ ────────────────▶ │ Scanning │ ──────────▶ │ Result sheet │
 └──────────┘                   └──────────┘             └──────────────┘
      ▲   ▲        cancel             │ error                │      │
      │   └───────────────────────────┘ (toast + retry)       │      │
      │            "Add photo" (keeps photos, follow-up flow) │      │
      └───────────────────────────────────────────────────────┘      │
      └─────────────────────── "New scan" (clears) ──────────────────┘
```

1. **Camera**: full-screen dark viewfinder with breathing corner brackets.
   Live camera via `getUserMedia` when allowed; otherwise the shutter opens the
   native camera/file picker. Gallery button bottom-left, flip camera
   bottom-right, demo-scenario pill and theme toggle top-right. Drag-and-drop
   anywhere on desktop. Taking or picking a photo starts the scan immediately.
   Photos kept for a follow-up show as a small tray above the shutter.
2. **Scanning**: the captured frame fills the screen with a slow zoom, the
   brackets lock in, a light line sweeps and dots pop across the image. One
   short status line cycles. Shown for at least ~1.6 s so it reads as a
   deliberate step. Cancel top-left.
3. **Result sheet**: the photo stays pinned at the top; a sheet springs up.
   - Status pill (Confirmed / Likely / Uncertain) + Demo pill.
   - Name, brand, model.
   - Stat tiles: lowest price, offer count, sources (shimmer while loading).
   - Verdict card (recommendation).
   - Segmented tabs: **Prices · Reviews · Details**.
   - Uncertain: "Add photo" call to action plus "Is it this?" candidates
     instead of tabs; prices and reviews stay paused.
   - Sticky "New scan" pill at the bottom.
   - Desktop: photo panel on the left, sheet on the right.

## Visual system

- Neutral ink/paper palette with a single banana-yellow accent (shutter, scan
  line, highlights). Camera and scanning screens are always dark; the sheet
  follows the light/dark theme.
- System font stack (SF Pro / Segoe UI Variable / Roboto) for a native feel.
- Motion: spring-like sheet entrance, staggered list fade-ups, shutter press
  scale, capture flash, shimmer skeletons. All motion respects
  `prefers-reduced-motion`.
- Copy kept to labels. Demo/synthetic data is still clearly marked, as
  AGENTS.md requires.
