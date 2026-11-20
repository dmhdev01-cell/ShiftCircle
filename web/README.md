# ShiftCircle web

React + TypeScript + Vite + MUI. `pnpm install`, then `pnpm dev` for the dev server on http://localhost:5173.
`pnpm build` type-checks and builds to `dist/`, and `pnpm test` runs the Vitest suite.
The api is called through `/api/` - proxied to `http://localhost:8081` in dev and to the api container by nginx in Docker.
`docker build .` builds the image: nginx serves `dist/` on port 80 and proxies `/api/` to `http://api:8081`, with `/healthz` for the health check.
