# Gemini Watermark Remover Design System

## Product Type

Single-purpose AI image utility landing page with embedded browser tool.

## Design Goal

Create a landing experience that feels like a trustworthy precision instrument: fast, transparent, and technically grounded.

## Visual Direction

### Overall Mood

- precise
- local-first
- high-signal
- modern without looking trend-chasing

### Style Recommendation

Use a **clean technical editorial** style:

- light background with subtle tonal layers
- crisp card edges instead of soft “blob” shapes
- restrained gradients only where they help focus
- strong visual rhythm through spacing, dividers, and proof sections

## Color System

### Core Palette

- Background: `#F5F7FA`
- Surface: `#FFFFFF`
- Surface Alt: `#EAF0F6`
- Text Strong: `#102033`
- Text Body: `#425466`
- Border: `#D5DEE8`
- Primary: `#1273EA`
- Primary Deep: `#0A4FB3`
- Accent: `#18B7A8`
- Success: `#0F9F6E`
- Warning: `#C57A10`

### Color Rules

- Use blue as the trust/technology anchor.
- Use teal as a secondary accent for “processed / clean / restored” moments.
- Avoid purple-heavy palettes and neon cyberpunk contrasts.
- Preserve high text contrast in all light-mode states.

## Typography

### Font Pairing

- Headings: `Space Grotesk`
- Body: `Instrument Sans`
- Technical labels / metadata: `IBM Plex Mono`

### Type Rules

- H1 should feel decisive and compact.
- Body text should stay readable and calm, around 16px minimum on mobile.
- Keep paragraph width controlled for SEO copy blocks.
- Use mono text sparingly for technical evidence, tags, or processing states.

## Layout System

### Desktop Structure

- Max content width: `1200px`
- Hero uses a two-zone layout:
  - left: headline, value proposition, trust cues
  - right: upload workspace or proof panel
- Keep the main tool visible above the fold.

### Mobile Structure

- Stack the hero vertically with the uploader first or second, never buried.
- Touch targets must be at least `44px`.
- Avoid horizontal overflow in any preview or batch state.

## Core Components

### Hero Upload Panel

- large drag-and-drop target
- clear file type support
- no ambiguous CTA text
- trust microcopy directly beneath the uploader

### Proof Module

- before/after frame or split comparison
- visible “original” and “cleaned” labels
- optional pixel-detail inset if later needed

### Trust Chips

Allowed themes:

- Local only
- Gemini specific
- Free
- Batch ready
- Open source

### Feature Cards

Each card must pair one promise with one concrete proof:

- local processing
- reverse alpha restoration
- batch workflow
- device compatibility

### FAQ

- keep answers short and factual
- use accordions only if they remain crawlable in HTML

## Motion

- Use `150ms` to `220ms` transitions for hover and focus.
- Use opacity and transform only.
- Respect `prefers-reduced-motion`.
- Best animation candidate: a subtle before/after reveal wipe in the proof section.

## Accessibility Rules

- 4.5:1 minimum contrast for body text
- visible focus states on every interactive element
- real labels for upload controls
- descriptive alt text on meaningful demo images
- keyboard-operable upload and download actions

## Copy Rules

- Primary phrase: `gemini watermark remover`
- Variants should be distributed naturally, never stacked repeatedly in one block.
- Prefer short, concrete claims over abstract marketing words.
- Always mention the main limitation: only the visible Gemini watermark is supported.

## SEO-Aware Content Blocks

The main money page should naturally contain:

- one strong H1
- short intro paragraph with the primary phrase
- proof section
- “how it works” section
- limitation section
- FAQ
- internal links to support articles

## Anti-Patterns

- emoji as core UI icons
- oversized glossy AI gradients
- giant dark hero with weak contrast
- repeated keyword lists masquerading as copy
- multiple identical CTA rows with no new information
- hover animations that shift layout

## Implementation Notes

- Use SVG icons from one consistent set such as Lucide.
- Keep the uploader and processing UI in Web Worker-friendly flows.
- Reserve space for previews and status messages to avoid content jump.
- Make the marketing content prerendered and the tool interactive layer hydrated after.

