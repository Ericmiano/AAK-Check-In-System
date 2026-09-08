# AAK Convention Connect

Build a production-ready web app called "AAK Convention Check-In" for the Architectural Association of Kenya Annual Convention 2026.

Reference brand and visual direction:

Study https://convention.aak.or.ke/ and closely match its visual identity, not a generic SaaS template.

The convention theme is:

"Shifting the Built Environment from Fragility to Resilience"

The event is:

AAK Annual Convention 2026

16 to 19 September 2026

Diamonds Leisure Beach & Golf Resort

Diani, Kwale County, Kenya

The app is an operational check-in system, not a convention registration or marketing website. It must open directly into the usable check-in experience.

Core terminology:

- Use "Get badge" for the public delegate-facing experience.

- Use "Find my badge" for badge retrieval.

- Use "Check-in" for the staff workflow.

- Use "Expected delegates" for people already imported into the system.

- Use "Add and check in" for walk-ins.

- Do not use "Register" as the main public navigation label because it suggests signing up for the convention itself.

- Explain clearly that getting a badge does not confirm payment, ticket purchase, or convention enrollment.

- The technical route may be `/badge`, even if internal database terminology uses registration.

User roles:

1. Delegate

Delegates can:

- Get a convention check-in badge by entering full name, email, organization, and optional phone.

- Retrieve an existing badge using an exact email address.

- View a large QR code badge after submission.

- See their name, organization, badge code, and a clear instruction to show the QR code at the check-in desk.

- Never see the delegate roster, staff dashboard, check-in tools, or staff controls.

2. Check-in staff

Staff can:

- Sign in using proper staff authentication.

- Scan QR codes using the device camera.

- Search by badge code, name, or email.

- Check in a delegate.

- See whether someone is already checked in.

- Add and check in a walk-in delegate.

- See useful result states: checked in, already checked in, not found, duplicate, connection error.

- Use the system comfortably on phones and tablets.

3. Event administrators

Administrators can:

- Import expected delegates from CSV.

- View total delegates, checked-in count, remaining count, and turnout percentage.

- Search and filter the delegate table.

- Export delegate data as CSV.

- View a check-in audit trail with staff member, timestamp, method, and device metadata.

- Manage staff accounts and roles.

Recommended architecture:

- Use Supabase Postgres as the database.

- Use Supabase Auth for named staff accounts.

- Use Row Level Security policies.

- Use a modern React or Next.js frontend.

- Use Vercel-compatible deployment.

- Use realtime updates for dashboard counts.

- Do not use Google Sheets or Apps Script.

- Do not use a shared PIN stored in localStorage.

- Do not rely on query-string routing for access control.

- Keep all authorization checks server-side.

- Never expose the full delegate roster to public users.

- Store QR codes as opaque random badge tokens, not email addresses or personal data.

- Make check-in operations atomic and idempotent so two devices cannot check in the same person incorrectly.

Suggested database tables:

- delegates

- staff_profiles

- check_ins

- import_batches

- audit_events

Suggested delegate fields:

- id

- badge_token

- full_name

- email

- organization

- phone

- source

- status

- created_at

- updated_at

Suggested check-in fields:

- id

- delegate_id

- checked_in_at

- checked_in_by

- method

- device_label

- notes

Required routes:

- `/badge`

- `/staff/login`

- `/staff/check-in`

- `/staff/dashboard`

- `/admin/staff`

- `/admin/import`

- `/admin/audit`

Public access rules:

- `/badge` is public.

- Public users may create a badge request or retrieve their own badge by exact email.

- Public users must never receive a list of matching people.

- Avoid partial name search on the public side because it can expose personal information.

- Do not show staff navigation or staff buttons to public users.

Staff access rules:

- Staff must authenticate through Supabase Auth.

- Use role-based access control for staff and administrators.

- Redirect unauthenticated users to `/staff/login`.

- Never treat the presence of a browser storage value as proof of authorization.

- If a session expires, show a clear session-expired message and return to staff login.

- Protect every staff API query with server-side authorization.

Staff check-in interface:

- Make this the primary operational screen.

- Use a compact header with AAK branding and a visible "Staff mode" indicator.

- Put the camera scanner in the main working area.

- Include a large manual search field below it.

- Provide clear, high-contrast result banners.

- Use large touch targets suitable for phones and tablets.

- Make the successful state visually distinct from already-checked-in and not-found states.

- Include a quick "Add and check in" panel for walk-ins.

- Add a camera permission state and a manual fallback if the camera is unavailable.

- Prevent duplicate submissions while a check-in request is in progress.

- Make scanning feedback immediate with subtle sound or vibration where supported.

Dashboard interface:

- Show four concise metrics:

  - Expected delegates

  - Checked in

  - Remaining

  - Turnout

- Show a dense, useful delegate table rather than oversized decorative cards.

- Include search, status filtering, organization filtering, and date/time information.

- Include CSV export.

- Include a practical import interface with validation and an import summary.

- Include recent check-in activity.

- Use responsive layouts that make good use of wide desktop screens without excessive empty space.

Visual direction:

Match the AAK Convention 2026 website:

- Warm coastal editorial atmosphere.

- Cream, sand, terracotta, coral, deep charcoal, muted olive, and ocean-inspired accent colors.

- Use restrained red or coral accents inspired by AAK branding.

- Avoid indigo, violet, purple-blue gradients, and default Tailwind blue palettes.

- Use real AAK Convention imagery where available, especially Diani, coastal architecture, coral stone, timber screens, and the Indian Ocean.

- Prefer the actual convention hero and Diani imagery from the reference site when licensing and technical access permit.

- If an image cannot be used, use a quiet textured color field or a real photographic asset, not abstract AI art.

- Use expressive editorial typography that feels architectural and cultural.

- Pair a distinctive display face with a highly legible sans-serif for controls and data.

- Use strong hierarchy, tight operational spacing, and deliberate asymmetry.

- Include subtle texture, framing lines, or architectural grid details inspired by drawings and built-environment plans.

- Keep the interface calm, premium, tactile, and practical.

- Cards should be used for tools and repeated records, not every page section.

- Avoid nested cards and excessive floating panels.

- Use Lucide icons or another consistent icon library.

- Never use emojis as interface icons.

- Use clear icons for scanning, search, download, import, users, shield, clock, and check-in.

- Add tooltips for unfamiliar icons.

Interaction and motion:

- Add a restrained page-load reveal.

- Add a subtle scan success animation.

- Add a small count transition on dashboard metrics.

- Use motion to communicate state, not decoration.

- Respect `prefers-reduced-motion`.

- Do not add generic bouncing, floating, pulsing, or gradient-orb animations.

Copywriting rules:

- Do not use em dashes anywhere in visible copy, documentation, comments, or generated content.

- Use commas, periods, colons, or separate sentences instead.

- Use straight quotes instead of curly smart quotes.

- Do not use vague marketing phrases such as "next-generation platform", "seamless experience", "unlock your potential", or "built for the future".

- Do not create fake testimonials, fake partners, fake statistics, fake staff names, or invented customer stories.

- Do not add a marketing hero section.

- Do not add an explanatory feature tour before the actual app.

- Keep copy specific to badge retrieval, delegate check-in, and event operations.

- Use concise labels such as:

  - "Get your convention badge"

  - "Find my badge"

  - "Show this QR code at the check-in desk"

  - "Staff check-in"

  - "Expected delegates"

  - "Add and check in"

  - "Checked in"

  - "Already checked in"

  - "No delegate found"

  - "Connection problem. Try again."

Avoid these AI-generated design patterns:

- No em dash-heavy copy.

- No indigo-to-violet palette.

- No generic dark SaaS dashboard.

- No left-border gradient cards.

- No emoji icons.

- No fake testimonials.

- No generic names such as John Smith or Sarah Johnson.

- No stock AI-generated people.

- No empty gradient-only backgrounds.

- No rigid three-card feature grids.

- No perfectly symmetrical repeated sections everywhere.

- No uniform card copy with identical lengths.

- No oversized hero with no operational content.

- No excessive whitespace on desktop.

- No meaningless decorative blobs or gradient orbs.

- No unnecessary numbered feature cards.

- No "Announcing v2.0" or startup-style marketing language.

- No visible text explaining obvious UI behavior or keyboard shortcuts.

- No curly quotes in interface copy.

- No placeholder content left in the finished UI.

Accessibility and quality:

- Meet WCAG AA contrast requirements.

- Support keyboard navigation.

- Use visible focus states.

- Label every input.

- Announce check-in results to screen readers.

- Make all controls usable on mobile.

- Ensure text never overflows buttons, cards, tables, or modals.

- Support narrow phone screens and wide desktop monitors.

- Add loading, empty, success, error, offline, and session-expired states.

- Add form validation for email and required fields.

- Add confirmation before destructive administrative actions.

- Add automated tests for public badge retrieval, staff authorization, QR check-in, duplicate check-in, CSV import, and expired sessions.

Build the actual working product, not a landing page. Seed the development environment with clearly marked fictional test data only, and make it easy to replace with real delegate data.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c45b1eca-05d6-48fa-a978-01a8b84f83de).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
