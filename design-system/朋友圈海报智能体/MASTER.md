# 朋友圈海报智能体 UI Design System

> Version 1.0.0 · 2026-08-05  
> Status: Active · Light theme  
> Visual source: [`../../visual-directions/direction-a-violet-lime.png`](../../visual-directions/direction-a-violet-lime.png)

This file is the visual source of truth for the project. Before building a page, read this file and then check `pages/<page-name>.md`. A page file may override a rule only when the difference is documented there. Otherwise this master specification wins.

## 1. Brand idea

The product should feel like a capable AI creative director: energetic, optimistic and visually bold, while remaining clear enough for people who do not understand prompts or design tools.

The system is defined by four color roles, not by using many bright colors everywhere:

- Deep violet builds structure and owns AI planning surfaces.
- Acid lime marks the single primary action and successful recognition.
- Vital orange highlights exact copy, annotations and attention points.
- Warm white provides breathing room and keeps the product professional.

Target balance on a typical light screen: `60%` warm neutral surfaces, `25%` violet structure, `10%` lime action, and no more than `5%` orange emphasis.

## 2. Non-negotiable principles

1. Each screen has one primary CTA. For the creation flow it is always `生成完整海报`.
2. Use spacing, alignment and typography before adding a new container.
3. Do not nest cards inside cards. A grouped form is one surface with dividers.
4. Lime is an action color, not a page background or paragraph-text color.
5. Orange is an emphasis color, not a second competing CTA.
6. The interface edits generation requirements, not image layers. Do not introduce canvas, layer panels or bottom-image-plus-text language.
7. Use real labels and helper text. Placeholders never replace visible labels.
8. Use Lucide outline icons only; never use emoji as structural icons.
9. Rounded geometry should feel generous, not bubbly or childish.
10. The v1 system is light-only. Do not invent a dark theme by inverting these colors.

## 3. Color system

### 3.1 Brand primitives

| Token | Value | Role |
|---|---:|---|
| `violet-950` | `#160A3A` | Primary ink, text on lime/orange |
| `violet-900` | `#2E0A8A` | AI panel gradient end |
| `violet-800` | `#4310AA` | Strong selected/pressed state |
| `violet-700` | `#5B16C9` | Brand primary, active tabs |
| `violet-600` | `#6D28D9` | AI panel gradient start |
| `violet-500` | `#7C3AED` | Decorative glow and icon surfaces |
| `violet-200` | `#D8C7FA` | Strong border |
| `violet-100` | `#ECE4FF` | Focus and selected tint |
| `violet-050` | `#F7F3FF` | Subtle section surface |
| `lime-500` | `#C8FF19` | Primary CTA, success recognition |
| `lime-600` | `#B5F000` | CTA hover |
| `lime-700` | `#9ED500` | CTA pressed |
| `lime-100` | `#EEFFC0` | Success tint |
| `orange-500` | `#FF8A1F` | Highlight, annotations, exact-copy emphasis |
| `orange-600` | `#E66C00` | Accessible orange text on light surfaces |
| `orange-100` | `#FFF0DF` | Warning/emphasis tint |
| `warm-white` | `#FFFDF8` | Page background |
| `white` | `#FFFFFF` | Forms, sheets and cards |
| `ink` | `#160A3A` | Primary text |
| `muted-ink` | `#665E75` | Secondary text |
| `soft-border` | `#E8DFF5` | Default divider and border |

### 3.2 Semantic mappings

| Semantic token | Default |
|---|---:|
| `background` | `warm-white` |
| `surface` | `white` |
| `surface-subtle` | `violet-050` |
| `text-primary` | `ink` |
| `text-secondary` | `muted-ink` |
| `border-default` | `soft-border` |
| `border-strong` | `violet-200` |
| `brand-primary` | `violet-700` |
| `action-primary` | `lime-500` |
| `attention` | `orange-500` |
| `focus-ring` | `violet-500` at 30% opacity |
| `danger` | `#C92A45` |
| `danger-surface` | `#FFF0F3` |
| `success` | `#267A35` |
| `success-surface` | `lime-100` |
| `warning` | `#9A4B00` |
| `warning-surface` | `orange-100` |

### 3.3 Approved contrast pairs

- `ink` on `warm-white`: 18.14:1.
- white on `violet-700`: 8.74:1.
- `ink` on `lime-500`: 15.61:1.
- `ink` on `orange-500`: 7.82:1.
- `muted-ink` on `warm-white`: 6.04:1.
- `orange-500` on `violet-900`: 6.51:1.

Never use lime text on white, orange body text on white, or white text on lime.

## 4. Typography

### 4.1 Font stack

```css
--font-sans: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Inter, system-ui, sans-serif;
--font-latin: Inter, "SF Pro Text", system-ui, sans-serif;
```

Use the same Chinese sans family for display and body. Personality comes from weight, scale and underlines rather than a second decorative Chinese font. Use Inter only for Latin letters, numbers and technical values.

### 4.2 Type scale

| Role | Desktop | Mobile | Weight | Line height |
|---|---:|---:|---:|---:|
| Display | 52px | 34px | 800 | 1.15 |
| Page title | 40px | 30px | 800 | 1.2 |
| Section title | 28px | 24px | 750 | 1.3 |
| Card title | 20px | 18px | 700 | 1.4 |
| Body large | 18px | 17px | 400 | 1.65 |
| Body | 16px | 16px | 400 | 1.65 |
| Label | 14px | 14px | 600 | 1.45 |
| Caption | 13px | 13px | 400 | 1.5 |
| Overline | 12px | 12px | 700 | 1.3 |

Headings may use `-0.02em` letter spacing. Body copy must use normal tracking and stay under 70 Chinese characters per line on desktop.

## 5. Spacing, grids and geometry

Use a 4px base grid. Preferred spacing tokens are `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80`.

### 5.1 Desktop

- Reference viewport: `1440px` wide.
- Content max width: `1384px`.
- Outer gutter: `28px` to `40px`.
- Main creation split: `7 / 5` columns, minimum gap `24px`.
- Header height: `72px`.
- Form section padding: `24px` to `32px`.
- AI planning panel padding: `40px` to `48px`.

### 5.2 Responsive

| Breakpoint | Behavior |
|---|---|
| `>= 1200px` | 12-column grid; input and AI plan side by side |
| `768-1199px` | 8-column grid; 55/45 split when readable, otherwise stack |
| `< 768px` | Single column: input, assets, AI plan, primary CTA |
| `< 480px` | 16px gutters; mode tabs scroll or become a two-row segmented control |

On mobile, keep `生成完整海报` reachable in a sticky action bar only after the user has reviewed the AI plan. Never let fixed UI cover scroll content.

### 5.3 Radius

| Token | Value | Use |
|---|---:|---|
| `radius-sm` | 10px | Inputs, chips, icon buttons |
| `radius-md` | 16px | Upload items, dropdowns |
| `radius-lg` | 24px | Main form surfaces |
| `radius-xl` | 32px | AI planning panel, hero blocks |
| `radius-pill` | 999px | Primary CTA, compact status chips |

The AI panel may use one asymmetric corner or angled edge to retain the selected concept's dynamic feel. Use this once per screen, not on every card.

## 6. Elevation and borders

This is a color-block system, not a shadow-heavy system.

- Default surfaces: 1px `soft-border`, no shadow.
- Raised menus: `0 12px 36px rgba(46, 10, 138, 0.14)`.
- Modal/sheet: `0 24px 64px rgba(22, 10, 58, 0.22)`.
- Primary CTA: optional `0 10px 28px rgba(200, 255, 25, 0.28)`.
- Do not apply hover lift to static informational cards.

## 7. Core components

### 7.1 Primary generation button

- Lime background, ink text, pill geometry.
- Desktop height `72px`; mobile height `56px`.
- Minimum horizontal padding `32px`.
- Label is explicit: `生成完整海报`.
- One arrow or sparkle icon is allowed; icon size `24px`.
- Hover uses `lime-600`; pressed uses `lime-700`.
- Loading keeps the button width stable, disables repeated submission and shows progress text.
- Disabled: `#E4E8D2` background, `#8A8D7F` text, no shadow.

### 7.2 Secondary button

- White or transparent background, violet text, 1.5px violet border.
- Height `44px` or `48px`; radius `12px`.
- Use for `修改方案`, `更换参考图`, `重新生成`.
- It must never visually compete with the generation button.

### 7.3 Mode tabs

- Active tab: violet background, white text and optional white line icon.
- Inactive tab: white or `violet-050`, ink text.
- Height `64px` desktop, `52px` mobile.
- Shared outer radius `16px 16px 0 0` when attached to the form surface.
- Selection state must use text and weight in addition to color.

### 7.4 Inputs and text areas

- Visible label above the field.
- White surface; 1.5px `violet-200` border; `radius-sm`.
- Minimum control height `48px`; textarea minimum `180px` desktop.
- Focus: violet border plus 3px translucent focus ring.
- Helper text sits below the field and uses `muted-ink`.
- Validation happens on blur. Errors explain the cause and the recovery action.
- Character counters use tabular numerals and remain secondary.

### 7.5 Reference upload items

- Use a horizontal group on desktop and a two-column grid on mobile.
- Each item has a persistent label: `人物参考图`, `产品/课程封面`, `Logo（可选）`.
- Preview ratio follows the asset type; do not crop logos into photo ratios.
- Remove controls are 44x44px hit targets with a visible text alternative for screen readers.
- Uploading, failed and replaced states must be explicit.

### 7.6 AI planning panel

- Gradient: `violet-600` to `violet-900`.
- White primary text, `violet-100` dividers.
- Lime indicates recognized intent and successful decisions.
- Orange marks exact poster copy or a single attention point.
- Group content as a readable list with dividers, not nested cards.
- Recommended heading: `AI 海报策划`.
- Use `已识别为：<类型>` as a status line, never a confidence percentage.

### 7.7 Status chips

- Height `28px` to `32px`; radius pill.
- Pair icon or text with color; never convey state by color alone.
- Recognition: lime surface with ink text.
- Attention: orange tint with warning text.
- Error: danger surface with danger text.

### 7.8 Navigation

- Warm-white background, 1px bottom divider only when scrolling.
- Brand left, no more than four primary destinations.
- Active item: violet text plus a 3px violet underline.
- Profile actions are secondary and must not compete with creation.

### 7.9 Dialogs and feedback

- Dialog max width `560px`, `radius-lg`, white surface.
- Scrim: `rgba(22, 10, 58, 0.52)`.
- Place errors near the related field and summarize multiple errors at the top.
- Toasts auto-dismiss in 4 seconds unless an action is required.
- Generation jobs use visible queued, generating, completed and failed states.

## 8. Iconography and decorative language

- Icon family: Lucide, outline style, `2px` stroke.
- Standard sizes: 16, 20, 24 and 32px.
- Decorative sparkles, hand-drawn underlines and short orange strokes may appear around one hero title or key AI heading.
- Maximum two decorative gesture groups per viewport.
- Never use emoji, mixed icon families, fake hand-drawn SVG scribbles in data-heavy areas or decorations that resemble controls.

## 9. Motion

| Token | Value | Use |
|---|---:|---|
| `motion-fast` | 120ms | Press and hover feedback |
| `motion-base` | 200ms | Tabs, inputs, menus |
| `motion-slow` | 320ms | Panel entrances and generation-state changes |
| `ease-standard` | `cubic-bezier(.2,.8,.2,1)` | Default |
| `ease-exit` | `cubic-bezier(.4,0,1,1)` | Exit |

Animate opacity and transform only. Loading transitions must communicate progress; decorative animation is limited to one or two focal elements. Respect `prefers-reduced-motion` by removing nonessential transforms and reducing duration to near zero.

## 10. Content voice

- Use direct, supportive Chinese: `我已读懂这条朋友圈`, `还需要一张人物参考图`.
- Avoid technical prompt language in the user interface.
- Buttons use a verb plus an object: `生成完整海报`, `更换参考图`.
- State errors include both cause and recovery.
- Image2 is an implementation detail. Mention it only where trust or generation behavior needs explanation.

## 11. Accessibility and interaction quality

- Normal text contrast must be at least 4.5:1; large text and graphical objects at least 3:1.
- All interactive controls need a minimum 44x44px target.
- Keyboard order follows visual order; no drag-only interaction.
- Every icon-only control has an accessible name.
- Focus rings are always visible for keyboard users.
- Do not disable browser zoom.
- Reserve dimensions for image previews and asynchronous sections to prevent layout shift.
- Use `aria-live="polite"` for generation progress and `role="alert"` for blocking errors.

## 12. Forbidden patterns

- Raw hex values inside page components; use semantic tokens.
- More than one lime primary CTA in the same viewport.
- Lime or orange used for paragraphs on warm-white backgrounds.
- Gradients on every card, glassmorphism, heavy blur or random shadows.
- Cards inside cards, dense dashboard metrics on the creation screen, or feature-inventory layouts.
- Emoji icons, mixed filled/outline icon sets or unlabeled icon buttons.
- A Photoshop-style canvas, layer tree, draggable text blocks or local text-overlay controls.
- Generating a background first and adding copy later.
- Decorative motion that delays input or blocks interaction.
- Desktop-only fixed widths or mobile horizontal scrolling.

## 13. Page override contract

Create `pages/<route-name>.md` only when a page has a real exception. Each override must state:

1. Which master rule is being overridden.
2. Why the page needs the exception.
3. The replacement token or behavior.
4. How responsive and accessibility behavior remains valid.

An override may not redefine the brand palette, type family, primary CTA color, icon family or accessibility minimums.

## 14. Delivery checklist

- [ ] The page reads this master file and any named page override.
- [ ] Only semantic tokens are used in components.
- [ ] One clear primary action is visible.
- [ ] Color balance stays close to 60/25/10/5.
- [ ] No cards are nested.
- [ ] Hover, pressed, focus, disabled, loading, success and error states exist.
- [ ] Text and control contrast has been checked.
- [ ] Keyboard and screen-reader labels are present.
- [ ] Layout works at 375, 768, 1024 and 1440px.
- [ ] Reduced motion is respected.
- [ ] The interface never suggests post-generation layer editing.
