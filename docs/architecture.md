# Open Print Stack: Architecture

How the SaaS is built. For what we're building and why, see [feature-plan.md](feature-plan.md).

Last updated: 2026-10-01.

---

## Overall shape

```
 USER'S NETWORK                              OUR CLOUD
┌──────────────────────┐        ┌────────────────────────────────────────────┐
│ Printers             │        │  Web app (browser / installable app)       │
│   ▲ local protocols  │        │        │ HTTPS + live connection           │
│   │ (Moonraker,      │        │        ▼                                   │
│   │  Bambu MQTT ...) │        │  ┌──────────────┐    ┌──────────────────┐  │
│ ┌─┴──────────────┐   │ always │  │ Agent        │───►│ Core API         │  │
│ │ Printer agent  │───┼────────┼─►│ gateway      │◄───│ (one deployable, │  │
│ │ drivers+camera │   │ open,  │  └──────────────┘    │  split into      │◄─┼─► Postgres + Redis
│ └────────────────┘   │outbound│                      │  modules)        │  │
└──────────────────────┘        │                      └────────┬─────────┘  │
                                │                          events│           │
                                │  ┌─────────────────────────────▼────────┐  │
                                │  │ Workers: slicing, thumbnails, AI,    │  │
                                │  │ notifications, webhooks, scheduler   │  │
                                │  └──────────────────────────────────────┘  │
                                │  File storage (S3-compatible)              │
                                └────────────────────────────────────────────┘
```

## Principles

1. **The agent translates; the cloud decides.** The agent turns each printer's protocol into one common set of messages and carries out commands. Smart routing, AutoPrint, scheduling and filament maths all run in the cloud.
2. **Everything is an event.** Printer state changes produce events (print finished, filament runout). Features such as history, filament tracking, notifications, AutoPrint and webhooks subscribe to the events they need.
3. **Files never travel over the agent's connection.** The agent downloads and uploads files directly to and from storage, using temporary links issued by the cloud.
4. **Live state and history are kept apart.** Live state (temperatures, progress) is held in Redis and pushed to browsers. Only meaningful events are written to the database.
5. **One deployable backend, split into modules.** Printers, files, queue/routing, filament, maintenance, billing and notifications are separate modules in one app. Only heavy, spiky work (slicing, thumbnails, AI) runs separately.
6. **One API for everything.** The web app, the public REST API and the MCP server all use the same endpoints.

---

## Stack

Rob is building this solo (with Claude), in TypeScript, so the stack is TypeScript everywhere with as little infrastructure as possible.

| Part | Choice |
|---|---|
| Repo | Monorepo with pnpm workspaces and Turborepo |
| Printer agent | TypeScript on Bun, built with `bun build --compile` into a single program for Pi, Linux, Windows and Mac. go2rtc ships alongside it as a prebuilt program for camera video. |
| Backend | Node LTS + Hono. Zod schemas validate requests and generate the OpenAPI spec. |
| Database | Postgres + Drizzle |
| Background jobs | pg-boss (job queue stored in Postgres), for anything that must never be lost |
| Live data | Redis, for fast, short-lived data that can be rebuilt (see [Redis](#redis)) |
| Login | Better Auth: passwords, 2FA, passkeys, Open Collective OAuth, staff invites |
| Frontend | React + Vite + TanStack Router/Query + Tailwind + shadcn/ui |
| 3D views | three.js via react-three-fiber |
| Slicing | Docker containers per slicer, run by a TypeScript worker. Kiri:Moto runs in the browser. |
| AI detection | ONNX Runtime, running a pre-trained model from TypeScript |
| File storage | Cloudflare R2 |
| Hosting | Managed platform (Fly.io or Railway) + managed Postgres |

### Repo layout

```
apps/
  web/        React app
  api/        Core API + agent gateway + live updates (one deployable)
  worker/     Background jobs: thumbnails, notifications, webhooks, scheduler
  slicer/     Slicing worker (Docker images with the slicer programs)
  agent/      Printer agent (Bun single program + go2rtc)
packages/
  protocol/   Agent ↔ cloud message definitions, shared by agent and api
  gcode/      G-code / 3MF parsing, thumbnails, safety check, plate splitting
  routing/    Smart routing engine + Queue Inspector explanations
  db/         Drizzle schema and migrations
  ui/         Shared React components
```

---

## Data model

```
Account ─┬─ User (owner / staff)
         ├─ Agent ── Printer ── FilamentUnit ── Slot ──► Spool
         ├─ Folder ── File (model / sliced) ─┐
         ├─ JobGroup ── Job ─────────────────┤ (Job points at a File)
         │              └─ PrintRun ◄────────┘ (one actual attempt on a Printer)
         ├─ FilamentProduct ── Spool ── SpoolUsage
         ├─ Tag, Macro, Webhook, NotificationChannel, ApiKey
         ├─ MaintenanceTask, Part, Dashboard
         └─ Event (log of everything that happened, and who did it)
```

| Area | Record | What it is |
|---|---|---|
| People | Account | The customer. Holds the plan, limits and Open Collective link. Every other record belongs to one account. |
| | User | A login: the owner or a staff member. |
| Printers | Agent | One installed agent: pairing credentials, version, last seen. |
| | Printer | A printer reached through an agent: driver, model, name, fixed capabilities, and current setup (nozzle size, plate type). |
| | FilamentUnit / Slot | An AMS, ACE, MMU or similar, and its slots. Each slot can hold a spool. |
| Files | Folder / File | A stored file, either a model (STL, unsliced 3MF) or print-ready (G-code, sliced 3MF), plus the information read from it. A sliced file links back to its source model. |
| Queue | Job | A request to print: file, quantity, priority, target printer (or "any"), requirements, deadline, custom fields. |
| | JobGroup | The parts of one order, kept together. |
| | PrintRun | One actual attempt on one printer: start/end, outcome, bed marked good/bad, filament used, cost, who started it. Print history is the list of PrintRuns. |
| Filament | FilamentProduct | A kind of filament: brand, material, colour, density, price per kg, temperatures. |
| | Spool | A physical spool: product, starting weight, location, NFC tag ID. |
| | SpoolUsage | One row per draw from a spool: which print run, how many grams. |
| Other | Tag, Macro, Webhook, NotificationChannel, ApiKey, MaintenanceTask, Part, Dashboard | Simple supporting records. |
| | Event | Log of everything that happened and who or what did it. Drives history attribution, webhooks and the activity view. |

### Decisions

- **A. Jobs and print attempts are separate records.** A job can produce many PrintRuns (quantity, plus reprints). A failed attempt is marked failed and the job still needs one more, which is how "bad print → back in queue" works.
- **B. Routing uses proper fields, with tags on top.** Anything smart routing understands (material, colour, nozzle size, plate type, printer model, build volume) is a proper field on jobs and printers. Free-form tags cover everything else.
- **C. Filament remaining comes from a usage log.** Remaining = starting weight minus all SpoolUsage rows. Weighing a spool adds a correction entry.
- **D. History never has holes.** Each PrintRun saves a copy of the key details (file name, thumbnail, printer name) at the time it ran. Deleted files and printers are hidden, not removed.
- **E. Every printer has at least one filament unit.** A single-spool printer has one unit with one slot, so there's one code path.
- **F. One login belongs to one account.** Someone who is staff elsewhere and also runs their own farm uses two logins.
- **IDs:** readable prefixed IDs in the API, e.g. `prt_...` (printer), `job_...` (job).

---

## Printer state model

The common format every driver reports, whatever the brand. The cloud only ever sees this format, so adding a new printer brand means writing one driver and nothing else.

```ts
type PrinterState = {
  status: "offline" | "idle" | "preparing" | "printing" | "pausing" | "paused"
        | "finishing" | "cancelling" | "error";
  job: {
    fileName: string;
    progress: number;                 // 0–1
    layer: { current: number; total: number } | null;
    elapsedSec: number;
    remainingSec: number | null;      // printer's estimate
  } | null;
  temps: {
    tools: { current: number; target: number }[];   // °C, one per nozzle
    bed: { current: number; target: number } | null;
    chamber: { current: number; target: number } | null;
  };
  fans: { part: number | null; aux: number | null; chamber: number | null };   // 0–1
  speedFactor: number | null;         // 1 = 100%
  flowFactor: number | null;
  filamentUnits: {
    slots: {
      reported: { material?: string; colour?: string; remaining?: number; tagUid?: string } | null;
      active: boolean;
    }[];
  }[];
  errors: { code: string; message: string; severity: "info" | "warning" | "error" }[];
};

type PrinterCapabilities = {
  buildVolume: { x: number; y: number; z: number };   // mm
  maxTemps: { tool: number; bed: number; chamber?: number };
  canSkipObjects: boolean;
  canBedMesh: boolean;
  canGcodeConsole: boolean;
  canFilamentLoadUnload: boolean;
  canSlotMapping: boolean;      // e.g. Bambu AMS mapping at print start
  hasCamera: boolean;
  // ...grows as features need it
};
```

The exact fields will grow as drivers are built; the decisions below are what's fixed.

### Decisions

- **A. Two layers of status.**
  - **Printer status** is what the printer reports.
  - **Farm status** is the cloud's own view, which the printer knows nothing about: available, needs bed cleared, reserved for a job, maintenance mode, or disabled.

  For example, a printer that reports "idle" after a print is "needs clearing" to us, and mustn't take a new job.
- **B. Capability flags drive the UI.** Controls are shown based on flags like `canSkipObjects`, never on the printer's brand, so new brands work in the UI automatically.
- **C. The cloud works out events from state.** The agent reports state; the cloud compares each state with the previous one to produce events such as print started, finished or failed. Drivers only send explicit events for things that can't be worked out from state, like printer error codes or a filament runout sensor.
- **D. Updates are sent sparingly.**
  - **On connect:** a full snapshot.
  - **After that:** only what changed.
  - **Telemetry** (temperatures, progress): about once a second while someone has the printer open, otherwise about every 30 seconds.
  - **Status changes and errors:** always sent instantly.
- **E. Slots keep reported and assigned filament separate.** "Reported" is what the printer says is loaded (e.g. the AMS reading a Bambu tag). "Assigned" is the Spool we've recorded in that slot. If they disagree, the user sees a warning; neither silently wins. Bambu spools can be auto-matched by tag ID.
- **F. Fixed units, and `null` means unknown.** °C, mm, seconds and grams throughout. Ratios from 0 to 1 for progress, fans and speed. `null` means "this printer doesn't report this", never 0.

Commands (pause, set temperature, skip object, and so on) are defined in the agent protocol. Capability flags decide which commands each printer allows.

## Agent protocol

How the agent and the cloud talk: a WebSocket (wss) connection carrying JSON messages, with message types and Zod schemas shared through `packages/protocol`. One connection carries every printer on that agent.

```ts
type Message = {
  v: 1;                  // protocol version
  id: string;            // unique, used for replies and avoiding duplicates
  type: string;          // e.g. "state.patch", "event", "cmd.print.pause", "cmd.result"
  printerId?: string;
  replyTo?: string;      // on a reply (command result, event ack, hello), the id it answers
  ts: number;
  payload: unknown;      // checked against a Zod schema per type
};
```

| Group | Direction | Needs a reply? |
|---|---|---|
| **State updates** | Agent → cloud | No. The next update corrects anything lost. |
| **Events** | Agent → cloud | Yes, the cloud confirms receipt. |
| **Commands** | Cloud → agent | Yes, a success or error reply, with a timeout. |

The command list grows driver by driver, following the capability flags.

### Decisions

- **A. Linking an agent uses a pairing code.** The agent shows a short code (e.g. `K7F-2QX`) in its console and local web page. The user enters it in the web app, and the agent receives its long-term credential. Docker installs can use a pasted token instead.
- **B. Each agent has its own secret.** A long random secret is saved on the agent's disk. The cloud stores only a hash of it, and the user can revoke an agent from the web app at any time.
- **C. Printer settings live in the cloud.** Printer passwords and access codes (Bambu access code, OctoPrint API key, etc.) are stored encrypted in the cloud and sent down to the agent. All setup happens in the web app. A replacement agent picks up the whole setup automatically. The agent stores nothing but its own credential.
- **D. The agent finds printers on the network.** It scans the local network and reports printers it finds; the web app offers to add them and asks for any passwords. Adding by IP address is the fallback.
- **E. Rules for when the connection drops.**
  - **Reconnecting:** the agent retries with growing, slightly random delays, so a deploy doesn't cause every agent to reconnect at once.
  - **After reconnecting:** a full state snapshot.
  - **Events while offline:** saved to disk and sent on reconnect. The cloud ignores any it already has, by message ID.
  - **Commands while offline:** **never queued.** They fail immediately with "printer offline". This is a safety rule: a late "start print" could run onto an uncleared bed.
- **F. Versioning and updates.**
  - **Version check:** the agent states its protocol version when it connects, and the cloud supports the current and previous versions.
  - **Updates:** the agent updates itself when the cloud says a new version is available. It downloads a signed program, checks the signature before installing, and never updates during an active print.
  - **Settings:** auto-update on by default, with a manual option.
- **G. Camera.**
  - **Snapshots:** uploaded over a separate HTTPS request, not the main connection. Only the latest frame is kept, in Redis; frames are saved to storage only when needed (AI detection, timelapse, a print run's photo).
  - **Live video:** WebRTC from go2rtc, with the agent connection used only to set up the call. Video streams directly from the user's network to the browser, relayed through our servers only when a direct connection fails.

## Event flow

How events get from the module that creates them to the features that react. Example: a print finishes.

```
Agent: status printing → idle, progress 100%
  │
  ▼
Cloud compares the new state with the old one → "print.finished"
  │
  ├─ Saved together, all-or-nothing:
  │    • PrintRun marked successful
  │    • Farm status → "needs clearing"
  │    • Event written to the event log
  │
  └─ Then each of these is run as its own background job:
       • Filament tracking → SpoolUsage rows
       • Notifications → push / Discord / email
       • Webhooks → user's endpoints
       • AutoPrint → starts the bed-clearing cycle
       • Maintenance → adds to the printer's usage counters
       • Browser → live update to anyone watching
```

### Events (draft)

| Group | Events |
|---|---|
| Printer | connected, disconnected, print.started, print.paused, print.resumed, print.finished, print.failed, print.cancelled, filament.runout, error.raised, error.cleared |
| Farm | bed.cleared, bed.marked_bad, printer.available, maintenance.due |
| Queue | job.queued, job.assigned, job.completed, job.requeued, job.deadline_at_risk |
| Filament | spool.low, spool.empty, slot.mismatch |
| Files | file.processed, slice.completed, slice.failed |
| AI | failure.suspected |
| Account | limit.reached, plan.changed |

### Decisions

- **A. No event is ever lost.** An event is saved in the same Postgres transaction as the change it describes, together with the background jobs that deliver it to subscribers (pg-boss). Either the change and its event are both saved, or neither is.
- **B. Core changes happen immediately; side effects happen in the background.** The module that owns the core change (PrintRun outcome, farm status, job status) makes it as part of the same save. Everything else (notifications, webhooks, filament, stats, AutoPrint) runs as background jobs.
- **C. Subscribers fail independently and are safe to run twice.** Each subscriber is its own job with its own retries, so one failure doesn't block the others. Every subscriber must produce the same result if it runs twice for the same event ID.
- **D. Ordered per printer, not globally.** Events for one printer are processed in order; different printers are processed in parallel.
- **E. A chosen set of events is public.** The event names and payloads exposed through webhooks, Zapier/n8n, MCP and notifications are a versioned public contract, changed carefully. Internal events are free to change.
- **F. Raw events are kept for about 90 days.** They drive the activity view and webhook redelivery. PrintRuns, SpoolUsage and maintenance history are the permanent records and are kept forever.
- **G. Built to run on more than one server from the start.** Live updates between servers, and getting each command to the server holding that agent's connection, go through Redis.

---

## Redis

Redis is used from the start for fast, short-lived data. Anything that must never be lost stays in Postgres; Redis only holds data that can be rebuilt. If Redis restarts, agents resend their full state on reconnect.

| Redis holds | Notes |
|---|---|
| Latest live state for every printer | Written on every state update from the agent |
| Live updates between servers | Pub/sub, so any API server can push to any browser |
| Which server holds each agent's connection | So commands reach the right server |
| Who's watching each printer | Switches telemetry between ~1 s and ~30 s updates |
| Latest camera frame per printer | Not stored long-term |
| Rate limiting | API, uploads, login attempts |

**Stays in Postgres:** durable background jobs (events, webhooks, slicing, notifications) via pg-boss. Moving them to a Redis queue would break the "no event is ever lost" guarantee, because the jobs could no longer be saved in the same transaction as the change.

**Hosting:** a normal managed Redis instance, not one billed per command, since live state is written constantly. Valkey, the open-source fork of Redis, works as a drop-in replacement.
