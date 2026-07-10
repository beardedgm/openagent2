# DESIGN.md

Authoritative reference for all client UI, visual, interaction, and UX decisions in this
repository, per `CLAUDE.md`. When this file and the code disagree, this file wins — fix the
code, or if the change is deliberate, update this file in the same PR. This document grows with
each stage; new components, tokens, or layout patterns are added here, not left implicit in
component code.

## 1. Purpose & scope

This is a single-tenant brokerage workspace: a daily-use internal tool for a real estate
brokerage's staff and agents (brokers, office admins, agents, transaction coordinators, and
limited external collaborators). It is not a marketing site and not a multi-tenant SaaS product —
there is one brand, one set of settings, one workspace.

This file covers:
- Design tokens (`client/src/styles/tokens.css`) and base element styles
  (`client/src/styles/base.css`).
- The UI primitive library (`client/src/components/ui/`).
- The runtime accent-color mechanism.
- Accessibility commitments that apply to every screen.
- Layout conventions for the app shell and page content.

Later stages (dashboards, transaction views, admin screens) build on this foundation. Before
adding a new visual pattern, component, or token, check here first.

## 2. Design principles

- **Professional and calm.** This is a brokerage back-office tool used for hours at a time, not a
  consumer app. Favor restraint over decoration: neutral surfaces, one accent color, no
  gradients, no illustration, no marketing flourishes.
- **Clarity over decoration.** Every visual choice should help someone scan a list, find a
  status, or complete a task faster. If a style choice doesn't aid comprehension, drop it.
- **Density appropriate for daily use.** Users open this dashboard repeatedly, every day. Prefer
  compact, information-dense layouts over generous marketing-style whitespace, while keeping the
  44px touch-target and spacing rules below non-negotiable.
- **Every interactive element is keyboard-reachable.** Buttons, fields, links, and modals must
  all be operable without a mouse, with a visible focus indicator at every step.
- **One source of truth for style.** Colors, spacing, and radii come from the tokens in
  `tokens.css`. Component and page code reference tokens (`var(--color-accent)`, etc.), never
  hardcoded hex values or magic pixel numbers, so the brokerage's brand can change at runtime
  without a code change.

## 3. Tokens

All tokens live in `client/src/styles/tokens.css`, scoped to `:root`. Reference them by variable
name everywhere; do not duplicate literal values in component styles.

| Token | Value | Usage |
|---|---|---|
| `--color-accent` | `#1d4ed8` (runtime-overridable) | Primary brand color: primary buttons, links, focus outline, active/selected states. Set at runtime from brokerage settings — see §4. Never hardcode this hex in a component. |
| `--color-bg` | `#f6f7f9` | Page/app background, behind cards and content. |
| `--color-surface` | `#ffffff` | Card, modal, input, and panel backgrounds — anything that sits "on top of" the page background. |
| `--color-border` | `#e3e6ea` | Default hairline borders on cards, inputs, and dividers. |
| `--color-text` | `#1a202c` | Primary body and heading text. |
| `--color-text-muted` | `#5b6572` | Secondary text: hints, captions, timestamps, neutral badges. |
| `--color-danger` | `#dc2626` | Destructive actions, error text/borders, `role="alert"` messages, danger badges. |
| `--color-success` | `#16a34a` | Success/positive status indicators (e.g. active, completed, paid). |
| `--color-warning` | `#b45309` | Warning/attention status that is not yet an error (e.g. pending, expiring soon). |
| `--radius-sm` | `6px` | Buttons, inputs, small controls. |
| `--radius-md` | `10px` | Cards, modals, larger surfaces. |
| `--shadow-sm` | `0 1px 2px rgb(16 24 40 / 6%)` | Resting elevation for cards. |
| `--shadow-md` | `0 4px 12px rgb(16 24 40 / 10%)` | Elevated surfaces: modals, popovers, dropdowns. |
| `--font-sans` | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | The only font stack. No custom web fonts unless explicitly added here first. |
| `--space-1` | `4px` | Tightest gaps: icon-to-label, label-to-input. |
| `--space-2` | `8px` | Small gaps within a control group. |
| `--space-3` | `12px` | Default gap between related elements; heading bottom margin. |
| `--space-4` | `16px` | Field bottom margin; standard horizontal button padding. |
| `--space-5` | `24px` | Card padding; page padding; gap between sections. |
| `--space-6` | `32px` | Large gaps: spinner padding, generous section separation. |

Do not introduce a new color, radius, shadow, spacing value, or font outside this table without
adding it here first. If a screen seems to need an "almost" value (e.g. 20px), use the nearest
token instead of a one-off number.

## 4. Accent color mechanism

The brokerage's brand color is not hardcoded — it is data. `Settings.primaryColor`
(`server/src/models/Settings.ts`) is a hex string (validated server-side against
`^#[0-9a-fA-F]{6}$`) that a broker can change from the admin settings screen. The client applies
it at runtime rather than baking it into a build:

1. `client/src/utils/applyAccentColor.ts` exports `applyAccentColor(hex: string): void`. It
   re-validates the hex format client-side (defense in depth against an unexpected value reaching
   the DOM) and, if valid, calls
   `document.documentElement.style.setProperty('--color-accent', hex)`. Invalid input is silently
   ignored, leaving the current accent in place.
2. Public, pre-login screens (e.g. the login page) fetch `GET /api/v1/settings/public`, which
   returns `{ settings: { brandName, logoUrl, primaryColor } }` with no auth required — this is
   the one settings field set safe to expose before authentication.
3. Authenticated screens have the same `primaryColor` available via `GET /api/v1/settings`
   (`Settings` type in `client/src/api/types.ts`).
4. Whichever screen loads first in a session should call `applyAccentColor(settings.primaryColor)`
   once the settings response resolves. Because `--color-accent` is a CSS variable read by every
   component (buttons, focus rings, links, accent badges), one call updates the whole app.

**Rule:** never hardcode an accent hex value in a component or page. Always read
`var(--color-accent)`, and only ever change what that variable resolves to via
`applyAccentColor`. If a component needs a color that is intentionally *not* brand-reactive (e.g.
a fixed danger color), use the appropriate semantic token (`--color-danger`, etc.) instead.

## 5. Components

All components live in `client/src/components/ui/`. Build every page from these primitives before
reaching for a raw `<div>`/`<button>`/`<input>`. If a page needs a pattern that doesn't fit an
existing primitive, propose the addition here (extend this table) rather than inventing a
one-off, page-local variant.

| Component | Purpose | Key details |
|---|---|---|
| `Button` | All clickable actions. | `variant` prop: `primary` (default — the one main action per view, uses `--color-accent`), `secondary` (default choice for everything else: cancel, secondary actions, toolbar buttons), `danger` (destructive actions: delete, deactivate, revoke). `disabled` dims to 60% opacity. Minimum 44px height comes from `base.css`, not the component itself. |
| `Field` | Labeled text input. | Always pass a visible `label` (no placeholder-as-label). `error` renders red border + `aria-invalid="true"` + a `role="alert"` message beneath the input — use for validation failures. `hint` renders muted helper text beneath the input for guidance that isn't an error. Don't use `Field` for non-text inputs (selects, checkboxes) until an equivalent primitive is added. |
| `Card` | Grouped content surface. | Default padding `--space-5`, `--radius-md`, `--shadow-sm`, bordered. Use for dashboard panels, list containers, and settings sections. Don't nest `Card` inside `Card`. |
| `Badge` | Small status/tag indicator. | `tone` prop: `neutral` (default, informational), `success`, `danger`, `accent`. Use for record status (active/pending/deactivated), role tags, and counts — not for primary content. |
| `Spinner` | Loading indicator. | `role="status"` with `aria-label` (default `"Loading"`) so screen readers announce it. Use while a query is pending; pair with the same `label` text a sighted user would want announced (e.g. `"Loading transactions"`). |
| `Modal` | Dialog overlay. | Wraps the native `<dialog>` element (`showModal`/`close`), not a custom overlay implementation — this gives native focus trapping and Escape-to-close for free. Always pass a descriptive `title` (used as `aria-label`); children only render while `open` is true, so state inside the modal resets on close. |

## 6. Accessibility commitments

These apply to every screen, not just the primitives above:

- **44×44px minimum touch targets** on all interactive elements (`button`, `[role='button']`,
  `input`, `select` get `min-height: 44px` from `base.css`; icon-only buttons must also meet this
  via padding, not just icon size).
- **Visible focus state everywhere.** `:focus-visible` gets a 2px `--color-accent` outline with
  2px offset globally — do not suppress this with `outline: none` on any interactive element.
- **WCAG 2.1 AA contrast** for text and meaningful UI elements. When the accent color changes at
  runtime (§4), any place accent color is used as a text/background pair must still meet AA —
  avoid pairing `--color-accent` text on `--color-bg` without checking contrast; prefer accent as
  a solid button background with white text, which is more resilient to brand color changes.
- **Icon-only buttons require `aria-label`.** Lucide React icons carry no accessible name on
  their own; any button whose only content is an icon must have an explicit `aria-label`
  describing the action (e.g. `aria-label="Delete transaction"`, not `aria-label="Delete icon"`).
- **`role="alert"` on field errors** so screen readers announce validation failures immediately
  (already built into `Field`'s `error` prop — don't re-implement error text without it).
- **Native semantics over custom widgets.** Prefer real `<button>`, `<dialog>`, `<label>` elements
  (as the primitives do) over `div`-based reimplementations, to keep keyboard and screen-reader
  behavior correct by default.

## 7. Layout conventions

- **App shell:** a fixed 240px-wide sidebar for primary navigation plus a 64px-tall header. The
  remaining area is the scrollable content region.
- **Content width:** page content has a max-width of 1100px, centered within the content region,
  with page padding of `--space-5` on all sides. Don't stretch text-heavy content (forms,
  settings, detail views) edge-to-edge on wide viewports.
- **Cards and sections** within a page stack vertically with `--space-5` gaps; related fields
  within a card use `--space-4` (the `Field` default bottom margin).
- **Tables** must be wrapped in a container with `overflow-x: auto` so wide data tables scroll
  horizontally within their own box on narrow viewports instead of breaking page layout or
  forcing the whole page to scroll sideways.
- **Responsive behavior:** below the point where the 240px sidebar plus 1100px content no longer
  fits comfortably, the sidebar should collapse (icon-only or off-canvas) rather than shrinking
  content below usable density — define the exact collapse breakpoint and pattern when the app
  shell component is built, and record it here.
