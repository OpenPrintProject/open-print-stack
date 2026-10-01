# Open Print Stack: Feature Plan

Open Print Stack is an open-source 3D print farm platform, built by Open Print Project. This document records the product decisions made so far and an outline of how each feature could be built. It started as a breakdown of [SimplyPrint's feature list](https://simplyprint.io/features), trimmed to fit our audience.

Last updated: 2026-10-01.

Sizes: **S** = days, **M** = 1–3 weeks, **L** = a month or more.

---

## Decisions

| Area | Decision |
|---|---|
| **Audience** | Solo makers and small businesses running multiple printers. No organisations, schools or enterprise features. |
| **Products** | A hosted SaaS and a self-hosted version, in separate codebases. |
| **Sequencing** | The SaaS is built first, to completion. The self-hosted version starts only after that. They are not developed together. |
| **Licence** | Both are fully open source under AGPL-3.0, with an app store exception (see [LICENSE-EXCEPTIONS.md](../LICENSE-EXCEPTIONS.md)). |
| **Contributions** | Accepted under the same licence, with a DCO sign-off on every commit (see [CONTRIBUTING.md](../CONTRIBUTING.md)). A CLA can be added later if needed. |
| **Copyright** | Open Print Project and contributors. |

### Plans

| Plan | Price | What you get |
|---|---|---|
| **Standard** | Free forever | Every feature. |
| **Supporter** | $3/month | Nothing extra. A way to support the project. |
| **Plus** | Paid | More storage, higher limits on anything that gets capped later, and staff accounts. |

- A plan changes numbers (storage, staff seats, any future caps), not which features you get. The code never checks for features.
- Subscriptions are handled through **Open Collective**. Users link their Open Collective account, and the SaaS reads Open Collective's API to apply limits.
- Limits apply per account.

### Staff accounts

- Plus only, counted as a number of seats (0 on Standard and Supporter).
- Staff have full access, with no roles or permissions system.
- The owner is the only one who can manage billing and staff.
- Every action in history records who did it.
- If Plus lapses, staff logins are suspended, not deleted. Their names stay in history, and they can sign in again once Plus is reactivated.

---

## Shared foundation

Almost every feature depends on these. Build them first.

| Piece | What it is |
|---|---|
| **Printer agent** | A small service on the user's local network (Docker or a Pi, or a plugin for Klipper/OctoPrint). It talks to the printers and opens an outbound connection to the SaaS. It needs secure device pairing and credentials that can be revoked. Don't hardcode the server address. |
| **Printer drivers** | One per printer family: Klipper/Moonraker (which covers Creality K1/K2, Elegoo Neptune, QIDI, Voron), Bambu (LAN mode), OctoPrint, PrusaLink, Elegoo and Anycubic. Every driver reports the same things: status, temperatures, progress, files, camera, and filament-unit slots. |
| **Server** | API, live updates, Postgres, background workers and S3 file storage. Each account's data is kept separate. |
| **Web app** | The main interface. The mobile app starts as an installable web app with push alerts, and goes native later. |
| **Camera** | Snapshots sent through the agent first. Then live video that connects the browser straight to the printer where possible, relayed through our servers only as a fallback. |
| **Usage and limits** | One system for storage and any future caps. Open Collective plugs into it. |

**Rules to follow from the start:**
- Record who did each action in history.
- Route every capped resource through the limits system.
- Keep core logic in clean, separate modules (drivers, routing, G-code/3MF parsing, NFC tag readers/writers) so it can be reused in the self-hosted version later.

**Existing open-source projects to reuse or borrow from:** Moonraker, Spoolman (filament), Obico (AI failure detection), Kiri:Moto (slicer), go2rtc (camera), Apprise (notifications).

**Bambu limitation:** full control needs the printer in LAN-only mode with Developer Mode on. In Bambu's cloud mode we can only monitor.

---

## Features

### Printing and printer control

| Feature | How we'd build it | Size |
|---|---|---|
| Monitor & print | Upload a file to a printer and start it through the agent. Most of the work is the drivers. | M |
| Control panel | Screens for the driver's commands: move the head, temperatures, fans, speed and flow, a G-code console, plus the camera. | M |
| Mobile app | Installable web app with push alerts first, native (React Native) later. | M→L |
| Notifications | Watch for printer state changes (finished, failed, paused, filament runout) and send them by email, push, Discord, Slack, Teams or SMS. Apprise covers most of these. | S |
| Bed level helper | Run the printer's auto-leveling, read the resulting map and draw it in 3D. Manual mode is a wizard that moves the head to each corner for a paper test. | M |
| Change filament | Guided wizard with temperatures per material and load/unload commands. Bambu has its own commands for the AMS. | S |
| Skip objects | Needs objects labelled in the G-code; we add labels if the file doesn't have them. A clickable plate view sends the skip command (different for Klipper, Marlin and Bambu). | M |
| Clear bed | After each print, a "needs clearing" step with a good/bad prompt. Bad prints go back in the queue. | S |
| G-code macros | Saved snippets for one printer, a group or all printers, inserted at start, end or pause, with variables. | S |
| Multi-actions | Select several printers and send each the same command. | S |
| Schedule print | A server-side scheduler that tells the agent to start the print at a set time. | S |
| Staggered start | Lets only N printers heat up at once, and releases the next when one reaches temperature. | S |

### Slicing

- **Kiri:Moto** runs entirely in the browser and is MIT-licensed. It's the default because it costs us nothing to run. It also covers belt printers.
- **Server-side slicing:** our own web screen (3D plate view, profile picker) with the slicers' command-line versions running on our servers in containers. PrusaSlicer, OrcaSlicer, BambuStudio and CuraEngine all have one. Each extra engine is mostly a new container plus its stock profiles.
- **Multi-colour:** the 3MF painting data passes straight through. Mapping colours to slots comes from the multi-material feature.
- Server-side slicing costs us money per slice, so it may need a fair-use cap.

Size: M for the first engine, then S per extra engine.

### Files and history

| Feature | How we'd build it | Size |
|---|---|---|
| Cloud files | File storage with a folder tree. Pull thumbnails from G-code and 3MF files, and render them for STLs. Read the slicer header for print time, filament, and which printer the file was sliced for. Storage limits per plan. | M |
| Print history | A log of every job that is only ever added to: filament used, cost, and who started it. Filters and CSV export. | S |
| Multi-plate 3MF splitting | A 3MF is a zip; take out each plate's G-code as its own job. | S–M |
| G-code safety check | Rules that flag temperatures above the printer's limit, moves outside the bed, unsupported commands, or a file sliced for a different printer. | S–M |

### Queue and automation

| Feature | How we'd build it | Size |
|---|---|---|
| **Smart routing** | **The core of the product.** Match what a job needs (material, colour, nozzle, plate, build volume, printer model) against each printer's capabilities and what's currently loaded. Includes Queue Inspector (shows why a job did or didn't match) and material clusters (treat PLA and PLA+ as the same, for example). | L |
| Print queue | Jobs list with priority, aimed at one printer or "any". Queue groups keep the parts of one order together. | M |
| Queue timeline | Simulate dispatch from estimated print times, show it as a Gantt chart, and flag missed deadlines. | M |
| Queue to-do list | Compare what waiting jobs need with what idle printers have loaded, and suggest physical swaps (spool, nozzle, plate). | S |
| 1-Click print | For each idle printer with a clear bed, start the best-matching job. | S |
| Tags and filename rules | Generic tags that the matching uses, and pattern rules that tag files from their names. | S |
| Custom fields | Fields the user defines (customer name, order number) that carry through from file to job to history. | S |
| Workflow automation | Webhooks and the REST API cover n8n and Activepieces. Zapier needs us to publish a Zapier app. | S–M |

### AutoPrint

An automatic cycle: print done → clear the bed → optional camera check → start the next matched job. Each bed-clearing method is a plugin.

| Clearing method | Approach |
|---|---|
| Manual | The user clears the bed and presses a button. |
| Custom G-code, print head push-off, Loop mod | Commands added to the end of the print. |
| Most Bambu A1 plate swappers | Usually triggered by commands added to the end of the print. Check each device. |
| Hardware with its own controller (FarmLoop, JobOx, 3DQue, AutoClear One and others) | A driver per device. Research each one and possibly partner with the makers. |
| Belt printers | Nothing to do; the part rolls off by itself. |
| API and webhooks | Wait for the user's own system to report that the bed is clear. |
| AI bed check | Compare a camera snapshot against a reference image of the empty bed. |

Size: M for the cycle itself, then S per device.

Build order within AutoPrint: manual, custom G-code, webhooks and belt printers first, then hardware devices one at a time.

### AI

| Feature | How we'd build it | Size |
|---|---|---|
| Failure detection | Self-host Obico's open-source model (AGPL), or train our own YOLO model. Pipeline: regular snapshots → detection → a confidence score over time → alert, pause or cancel. Run it on the agent where the hardware allows, to keep our costs down, with server-side detection as a fallback. | M–L |
| MCP for AI assistants | An MCP server that wraps our REST API as tools (list printers, check status, start, pause, queue). | S |

### Filament and multi-colour

| Feature | How we'd build it | Size |
|---|---|---|
| Filament manager | Spools, filament types, locations and costs. Either compatible with Spoolman or built into it. | S–M |
| Automatic tracking | Take grams per tool from the G-code, or live figures from the printer or AMS, and subtract them from the assigned spool. Cancelled prints are charged in proportion to how far they got. | S |
| NFC reading and writing | Browser reading (Chrome on Android only), native app reading (iOS can't do MIFARE Classic), and USB readers through the agent. | M |
| Open tag formats | OpenPrintTag, OpenSpool, OpenTag, TigerTag. Each has a published spec, so it's just a reader and writer. | S each |
| Bambu tags | MIFARE Classic tags; the community has documented how to derive the keys. Read-only, because the tags are signed. | S–M |
| Creality CFS, Anycubic ACE, ELEGOO Canvas, QIDI Box tags | Proprietary formats that need reverse-engineering and test hardware for each brand. Some legal and terms-of-service risk. | M each |
| Labels and scanning | QR or barcode labels and in-browser camera scanning. | S |
| DYMO and Zebra printing | DYMO through its local SDK; Zebra through ZPL. Don't copy their proprietary code into the repo. | S |
| Multi-material | Track slot state for each unit (AMS, ACE, CFS, MMU, Palette), read the colours in a file, and provide a mapping screen. Bambu accepts the mapping at print start. For the others we only record it. | M |

### Running the farm

| Feature | How we'd build it | Size |
|---|---|---|
| Statistics | Totals over print history (success rate, print time, filament, cost), shown as charts. | S–M |
| Printer maintenance | Usage counters per printer (hours, prints, km of filament), task templates that fall due at set intervals, and checklists. For Bambu, map the printer's built-in error codes to tasks. | M |
| Spare parts | A stock list of nozzles, belts and other parts, with low-stock alerts. | S |
| Custom dashboards | A drag-and-drop grid of cards (for example react-grid-layout). | M |
| Kiosk view | A full-screen status display for the printer room, without sign-in. | S–M |
| Enhanced cost calculation | Electricity (watts × time × tariff), labour, and the real price per gram of the spool. | S |

### Developers

| Feature | How we'd build it | Size |
|---|---|---|
| REST API | Comes for free if we build API-first: an OpenAPI spec and scoped API keys. One API covers every printer brand through the drivers. | S ongoing |
| Webhooks | Event subscriptions, signed payloads and retries, with formatting for Discord, Slack and Teams. | S |

### Account and SaaS

| Feature | How we'd build it | Size |
|---|---|---|
| Open Collective limits | Users link their Open Collective account with OAuth. Webhooks give fast updates, and a daily re-check catches anything missed. Tier IDs are mapped to limit sets in config. Allow a grace period (e.g. 7 days) when a payment fails, and count both monthly and yearly contributions as active. Handle guest contributions with a "claim my contribution" flow that matches on email. | M |
| Staff accounts | Invite emails, a staff list screen, and recording who did what (see [Staff accounts](#staff-accounts)). | S–M |
| Two-factor login | TOTP and WebAuthn. | S |
| Support access approval | Staff can only see a user's account through a time-limited grant the user approves. | S |
| Dark mode and cosmetics | Theme colours, custom printer photos. | S |

**When an account goes over its limits** (for example after Plus lapses), existing files stay readable, but new uploads are blocked until usage is back under the limit. Nothing is deleted automatically.

---

## Not building

These SimplyPrint features don't fit our audience:

- multiple users and organisation management
- roles, permissions, workgroups and temporary access
- SSO, and school class sync/rostering
- print quotas and prepaid credit
- school classes and teacher/student dashboards
- Academy and feature unlocks
- print approval
- the shared-screen Hub where staff sign in
- FERPA/COPPA compliance and an uptime SLA

---

## Build order

1. **Foundation:** agent and drivers, server, web app, monitoring, control panel, camera, files, history, notifications.
2. **Farm basics:** queue, tags, smart routing, filament manager, multi-material slot mapping, macros, multi-actions.
3. **Automation:** AutoPrint, scheduling, staggered start, webhooks and API, MCP.
4. **Differentiators:** cloud slicer, AI failure detection, NFC tags.
5. **Running the farm:** statistics, maintenance, dashboards, cost calculation, kiosk view, Open Collective limits, staff accounts.

---

## Still open

- **Tech stack:** not chosen yet.
- **Plus:** price and number of staff seats.
- **Fair-use caps on Standard:** server-side slicing, AI detection hours, camera relay and SMS. Exact figures can wait until costs are known.
- **Abuse protection for free storage:** restrict uploads to print and model file types, add rate limits, and clean up abandoned files.
- **Open Collective API:** check the exact webhook events, and the field that shows a recurring contribution is active.
- **Bambu and other proprietary tag keys:** whether they live in the repo or are read at runtime.
- **Trademark:** register "Open Print Stack".
- **Legal:** register Open Print Project as an entity to hold the copyright, and get a lawyer to review the app store exception before publishing the mobile app.
- **Contributors:** turn on GitHub's DCO app, and decide on a CLA, once outside contributions arrive.

### Deferred until the self-hosted version starts

- Shared packages vs fully independent code.
- Whether self-hosted has staff logins (unlimited if so, since it has no plans).
- A push relay so self-hosted servers can send phone alerts through the official app.
- Simpler install options (SQLite, single container).
