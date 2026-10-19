# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI Image Studio: a React 19 + TypeScript + Vite 8 + Tailwind CSS v4 single-page app. Users upload two images (Bild1 = person, Bild2 = garment), the app POSTs them to its own server function `api/generate.ts` (Vercel), which forwards them to an n8n webhook, and n8n returns a generated image that the app displays and offers for download. All image generation happens in n8n. Never add mock or local generation as a fallback.

The app is only usable after signing in via Supabase Auth (email + password, with name captured at sign-up and email confirmation required).

`PRD_AI_Image_Studio.md` is the binding functional spec, and `Kopfbedeckungen.jpg` is the visual design reference. UI copy is German, except for the fixed English labels "Generate Image", "Creating your image…" and "Create your look".

## Commands

```bash
npm install
npm run dev        # Vite dev server, http://localhost:5173
npm run build      # tsc -b (type check) + vite build -> dist/
npm run typecheck  # tsc -b only
npm run preview    # serve dist/ (static only: /api/generate is not available there)
```

There is no test runner and no linter configured. Verify changes with `npm run build`.

## Git

- Remote `origin` is https://github.com/kaybritti/Bild-App, default branch `main`.
- `node_modules` and `dist` are gitignored. `.env` is committed on purpose so hosted builds (Vercel) get the webhook URL and Supabase settings; it must only ever contain public values, never secrets. Secrets go in `.env.local` (gitignored via `.env.*`) and in Vercel's environment variables.
- The commit identity is set repo-locally: `kaybritti <bmbartel@gmx.de>`.
- Pushing over HTTPS goes through the Git Credential Manager. When no login is cached, `git push` waits silently for a browser sign-in, so a non-interactive push can appear to hang until the user signs in.

## Configuration

- The browser never sees the n8n webhook URL or its credentials. Both exist only server-side (no `VITE_` prefix):
  - `N8N_WEBHOOK_URL` lives in `.env` (committed, public).
  - The webhook credentials live in `.env.local` and in Vercel. Use either `N8N_AUTH_HEADER_NAME` + `N8N_AUTH_HEADER_VALUE` (n8n Header Auth) or `N8N_BASIC_AUTH_USER` + `N8N_BASIC_AUTH_PASSWORD` (Basic Auth).
  - The webhook has Authentication enabled in n8n. A call without credentials gets `403 "Authorization data is wrong!"`.
- On Vercel, set `N8N_WEBHOOK_URL`, the auth variables, and `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` as project environment variables for the function runtime. The function also falls back to the `VITE_SUPABASE_*` names. Don't rely on the committed `.env` reaching the function at runtime.
- Restart the dev server after changing `.env` or `.env.local`.
- The current URL is the n8n **production** webhook (`/webhook/…`). It only responds while the workflow is activated in n8n. The **test** variant (`/webhook-test/…`) only accepts one request after "Execute workflow" / "Listen for test event" is clicked. Either way, an unregistered webhook returns HTTP 404.
- **Local dev:** `vite.config.ts` registers a dev middleware that runs the same `POST` handler from `api/generate.ts` at `/api/generate`, so local and Vercel behave identically.
  - The middleware copies the server-side keys from `.env` / `.env.local` into `process.env` (`SERVER_ENV_KEYS`). Add new server variables there.
  - It rebuilds a Web `Request` from the Node request (dropping hop-by-hop headers) and writes the Web `Response` back.

## Supabase (login)

- Project `vboojmnviogfrdjymmgv`, connected as the `supabase` MCP server. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) live in `.env`. Both are public; never put the secret or service-role key there.
- Database: `public.profiles` (`id` → `auth.users.id` with cascade delete, `name`, `created_at`).
  - RLS is on. Signed-in users may only `select`/`update` their own row; there is no client `insert`/`delete`.
  - Rows are created by the `security definer` trigger function `public.handle_new_user()` (trigger `on_auth_user_created` on `auth.users`). It takes `raw_user_meta_data->>'name'` and falls back to the email local part.
  - Schema changes go through `apply_migration`; run `get_advisors` (security) afterwards.
- Email confirmation is on. `signUp` passes `emailRedirectTo: window.location.origin`, so every app origin (localhost:5173, Vercel) must be listed under Authentication → URL Configuration in the Supabase dashboard.
- Generation is protected server-side. `api/generate.ts` requires `Authorization: Bearer <Supabase access token>` and verifies it with `GET {SUPABASE_URL}/auth/v1/user` before calling n8n. The browser gets the token from `getAccessToken()` in `authService.ts`.

## Architecture

The data flow is one-directional: hooks hold state, `App.tsx` wires them to presentational components, and only `src/services/` touches the network.

- **`src/App.tsx`**: renders `Header`, then by `AuthState` (`loading | signedOut | signedIn`) a status line, `AuthScreen` or `Studio`, then `Footer`. `Studio` holds the former upload/generate/result page; it unmounts on sign-out, which aborts a running request and frees object URLs.
- **`src/services/authService.ts`**: `signUp`, `signIn`, `signOut` and `subscribeToAuth` over the client in `supabaseClient.ts` (which is `null` when the env values are missing).
  - Failures throw `AuthServiceError` with user-facing German text, mapped from Supabase error codes. A sign-up for an existing confirmed address returns a user with empty `identities` instead of an error; it is treated as "already registered".
  - `signOut` never throws, because supabase-js removes the local session even when the server call fails.
- **`src/hooks/useAuth.ts`**: subscribes via `onAuthStateChange` (its `INITIAL_SESSION` event replaces a separate `getSession`). The display name comes from `user_metadata.name`.

- **`api/generate.ts`** (Vercel Function, Web signature `export async function POST(request)`): login check, then forwards the multipart body unchanged (including the `content-type` with its boundary) to `N8N_WEBHOOK_URL` with the auth header added, and returns n8n's image response unchanged.
  - It must stay self-contained (no relative imports), because Vercel bundles it on its own. It is type-checked through `tsconfig.node.json`.
  - All of its errors are JSON `{ error: "<German message>" }`. n8n failures map to HTTP 502 with a status-specific message.
  - Limits: Vercel accepts at most 4.5 MB per request body (`MAX_BODY_BYTES`). `maxDuration` is 180 s in `vercel.json`, and the upstream timeout is 170 s.
- **`src/config.ts`**: single source for `GENERATE_ENDPOINT` (`/api/generate`), the Supabase URL/key, the minimum password length (6), accepted MIME types (`image/jpeg`, `image/webp`), the input size limit (25 MB), the upload target (2 MB / 2048 px per image, so both fit under Vercel's 4.5 MB) and the request timeout (180 s).
- **`src/services/n8nService.ts`** (`generateImage`): builds `FormData` with the field names `Bild1` and `Bild2`. Those names are a contract with the n8n workflow and are case-sensitive.
  - It POSTs to `/api/generate` with the Supabase bearer token. Never set the `Content-Type` header manually; the browser adds the multipart boundary.
  - The response must pass three checks: `response.ok`, a `Content-Type` of `image/jpeg` or `image/webp`, and a magic-byte check of the blob.
  - Error text comes from the server's JSON `error`, with a fallback from `messageForStatus` for platform errors. All failures throw `GenerationError`, whose message is shown verbatim in the UI. Keep these messages user-facing German text.
  - The timeout uses an internal `AbortController`, which also forwards an external abort signal.
- **`src/utils/resizeImage.ts`** (`prepareForUpload`): files over 2 MB are redrawn on a canvas.
  - The bitmap uses EXIF orientation, and the canvas gets a white background because JPEG has no transparency.
  - Attempts step down from 2048 px / quality 0.9 to 1280 px / 0.75 until the file is ≤ 2 MB, and the result is saved as `.jpg`. Smaller files pass through unchanged.
- **`src/utils/validateImage.ts`**: `detectImageType` sniffs JPEG/WebP magic bytes. It is shared by input validation and response validation.
  - Input files with an empty or mismatched `file.type` are re-wrapped as a `File` with the detected MIME type, so the multipart part carries the correct content type.
- **`src/hooks/useImageFile.ts`**: one instance per upload slot.
  - It validates the file, runs `prepareForUpload`, then creates a preview object URL from the file that will actually be sent. The URL is revoked through effect cleanup keyed on the `image` object.
  - `processing` is true while this runs. `Studio` blocks generation during that time, and the card shows "Wird vorbereitet".
  - A `selectionId` ref discards results from stale async selections.
  - An invalid new file leaves the previously selected image in place.
- **`src/hooks/useGeneration.ts`**: a state machine typed as the discriminated union `GenerationState` (`idle | loading | success | error`) in `src/types.ts`.
  - An `inFlight` ref (not state) blocks double submits synchronously.
  - The result object URL is revoked when it changes or on unmount.
  - Starting a new generation sets `loading`, which hides the old result as the PRD requires.
  - Aborted requests (via reset or unmount) are swallowed silently.
- **`src/components/ResultPanel.tsx`**: renders all four states. On `lg` and up it uses an explicit CSS grid placement (text and actions on the left, image frame on the right), while the DOM order stays text → frame → actions for screen readers.

## Styling conventions

- Tailwind v4 is configured CSS-first in `src/index.css` via `@theme`. There is no `tailwind.config.js`.
- Use the theme tokens rather than raw hex values:
  - colors: `paper`, `sand`, `sand-light`, `ink`, `stone`, `stone-dark`, `error`
  - fonts: `font-serif` (Cormorant Garamond), `font-sans` (Inter), `font-mono` (JetBrains Mono); fonts load from Google Fonts in `index.html`
  - custom breakpoint `xs` (360px), below which the two upload cards stack
  - animations: `shimmer`, `progress`, `fade-in`
- Visual language: minimal editorial fashion look.
  - No shadows, no colored accents and no decorative borders.
  - Selected or active image frames get a thin `outline outline-offset-4 outline-ink`, mirroring the active thumbnail in the reference screenshot.
  - Small labels use uppercase mono with wide tracking.
  - Use `stone-dark`, not `stone`, for small text (contrast).
- Accessibility: there is a global `:focus-visible` outline, and a `prefers-reduced-motion` override disables animations.
  - The hidden native `<input type="file">` is triggered from a visible button.
  - Errors use `role="alert"`, and the loading state uses `role="status"`.
- `lucide-react` icons use thin strokes (`strokeWidth` 1–1.5) and `aria-hidden="true"`.

## Expected n8n workflow contract

- Webhook: POST only, with the response mode set to "Using 'Respond to Webhook' Node". GET is intentionally not enabled because the images travel in the request body. Don't probe the URL with GET or a browser visit: n8n answers with a "not registered" error, which looks like an inactive test webhook. Test with a real multipart POST.
- A **Respond to Webhook** node returns a *Binary File* with `Content-Type: image/jpeg` or `image/webp`. The response must also stay under Vercel's 4.5 MB response limit.
- Authentication (Header Auth or Basic Auth) is on. The credentials are known only to `api/generate.ts`.
- CORS no longer matters, because n8n is called server-to-server.

JSON, URL or async job-ID responses are explicitly out of scope for the MVP.
