# Milestone 1: End-to-end slice

**Goal:** pair an agent, see a printer's live status and camera snapshot in the web app, upload a file, and start, pause and cancel a print.

This is a thin slice through every layer: agent, protocol, gateway, Redis, database, file storage and UI. It proves the architecture in [architecture.md](architecture.md) works end to end before features are built out. Build against the **simulated printer** first, then add the **Elegoo Centauri Carbon 2** driver for real hardware (see [printers/elegoo-cc2.md](printers/elegoo-cc2.md)).

## Steps

1. **Driver interface and simulated printer** (`apps/agent`)
   - Define the driver interface every brand implements: connect, report state and capabilities, run commands.
   - Build a simulated printer that heats up, prints with progress and layers, pauses, cancels, can be made to fail or run out of filament on demand, and produces a camera snapshot image.
   - Make it usable in automated tests.
2. **Protocol messages** (`packages/protocol`)
   - Zod schemas and types for `PrinterState`, `PrinterCapabilities`, hello/auth, state snapshot and patch, events, commands and command results.
   - Follow the [printer state model](architecture.md#printer-state-model) and [agent protocol](architecture.md#agent-protocol).
3. **Accounts and login** (`apps/api`, `apps/web`)
   - Better Auth with email and password, one owner per account.
   - Staff, 2FA, passkeys and Open Collective come later.
4. **Database tables** (`packages/db`)
   - Account/user (from Better Auth), Agent, Printer, FilamentUnit/Slot, File, PrintRun and Event.
   - Only the fields this milestone needs, following the [data model](architecture.md#data-model) decisions.
5. **Agent gateway** (`apps/api`)
   - WebSocket endpoint and agent authentication: the agent's secret is stored hashed.
   - Live state goes into Redis. Track which server holds each agent's connection.
   - Commands get replies and timeouts. Commands to an offline printer fail immediately; they're never queued.
6. **Pairing**
   - The agent shows a pairing code; the user enters it in the web app; the agent receives its credential.
   - Printers and their settings are added in the web app and sent down to the agent.
7. **Live updates to the browser**
   - The web app gets live printer state over a WebSocket.
   - Telemetry switches between about 1 s and about 30 s depending on whether someone is watching.
8. **Files**
   - Upload to S3-compatible storage. Add MinIO to `docker-compose.yml` for local development; production uses R2.
   - The agent downloads with a temporary link and sends the file to the printer.
9. **Web app**
   - Sign in, pair an agent, add a printer, see live status and a camera snapshot.
   - Upload a file, then start, pause, resume and cancel.
   - Basic layout only; visual design comes later. This step adds Tailwind, shadcn/ui and TanStack Router/Query.
10. **Events and print history**
    - The cloud works out `print.started`, `print.paused`, `print.finished`, `print.failed` and `print.cancelled` from state changes.
    - Each event is saved in the same transaction as the PrintRun change (pg-boss).
    - The web app shows a simple history list.
11. **Elegoo CC2 driver**
    - MQTT session registration and heartbeat, status merging, commands (one at a time), file upload, camera, and CANVAS slot reporting.
    - Block method 1039 (firmware flash).
    - Work through the "To test on the real printer" list in [printers/elegoo-cc2.md](printers/elegoo-cc2.md). This needs LAN Only mode switched on.

## Done when

- [ ] A fresh agent can be paired to an account from the web app.
- [ ] A simulated printer shows live status and a camera snapshot in the web app.
- [ ] A file can be uploaded and printed on the simulated printer, then paused, resumed and cancelled.
- [ ] Finished, failed and cancelled prints appear in history, with their events saved.
- [ ] Disconnecting the agent shows the printer as offline, and commands fail immediately.
- [ ] The same flow works on the real Elegoo Centauri Carbon 2.
- [ ] Tests cover the protocol, the gateway and the simulated printer flow, and CI passes.

## Not in this milestone

Queue and smart routing, filament tracking, notifications, AutoPrint, slicing, AI, other printer brands, staff accounts, Open Collective, deployment and hosting.
