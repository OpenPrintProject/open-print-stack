# Open Print Stack

An open-source platform for running a 3D print farm: monitor and control printers from anywhere, queue and route jobs, track filament, and automate the farm. Built by Open Print Project.

- [Feature plan](docs/feature-plan.md)
- [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)

## Development

You need Node 24+, pnpm (`corepack enable pnpm`), Bun, and Docker (e.g. OrbStack).

```bash
pnpm install
cp .env.example .env
pnpm db:up      # start Postgres and Redis
pnpm dev        # run the API, web app and agent in watch mode
```

| Command | What it does |
|---|---|
| `pnpm dev` | Run everything in watch mode |
| `pnpm build` | Build the web app and the agent program |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Run all tests |
| `pnpm lint` | Check formatting and lint rules |
| `pnpm format` | Fix formatting and safe lint issues |

### Layout

```
apps/
  api/        Core API, agent gateway and live updates (Hono, Node)
  web/        Web app (React, Vite)
  agent/      Printer agent, compiled to a single program with Bun
packages/
  protocol/   Agent ↔ cloud message definitions
  db/         Database schema and migrations (Drizzle)
```

## License

[AGPL-3.0](LICENSE), with an [additional permission](LICENSE-EXCEPTIONS.md) for app store distribution.
