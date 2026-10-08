<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Streetprice project guidance

- Use Node.js 22.12 or newer and install dependencies with `npm ci`.
- Before handing work back, run `npm run lint`, `npm test`, and `npm run build`.
- The deployed dashboard reads the committed `data/snapshot.json`; keep it usable without NeRDA credentials.
- A production snapshot must preserve all 187 LV feeders and 85 substations. Missing readings stay visible as gaps or grey map features rather than being dropped.
- Never commit `.env.local`, NeRDA credentials, raw annual history, ingest caches, or generated MapLibre worker files.
