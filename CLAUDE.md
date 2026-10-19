# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI Image Studio: a React 19 + TypeScript + Vite 8 + Tailwind CSS v4 single-page app. Users upload two images (Bild1 = person, Bild2 = garment), the app POSTs them to an n8n webhook, and n8n returns a generated image that the app displays and offers for download. All image generation happens in n8n. Never add mock or local generation as a fallback.

`PRD_AI_Image_Studio.md` is the binding functional spec, and `Kopfbedeckungen.jpg` is the visual design reference. UI copy is German, except for the fixed English labels "Generate Image", "Creating your image…" and "Create your look".

## Commands

```bash
npm install
npm run dev        # Vite dev server, http://localhost:5173
npm run build      # tsc -b (type check) + vite build -> dist/
npm run typecheck  # tsc -b only
npm run preview    # serve dist/
```

There is no test runner and no linter configured. Verify changes with `npm run build`.

## Git

- Remote `origin` is https://github.com/kaybritti/Bild-App, default branch `main`.
- `.env`, `node_modules` and `dist` are gitignored. Never commit `.env`.
- The commit identity is set repo-locally: `kaybritti <bmbartel@gmx.de>`.
- Pushing over HTTPS goes through the Git Credential Manager. When no login is cached, `git push` waits silently for a browser sign-in, so a non-interactive push can appear to hang until the user signs in.

## Configuration

- `VITE_N8N_WEBHOOK_URL` is set in `.env` (gitignored). `.env.example` is the template.
- The value is inlined at build time and visible in the browser, so never put secrets in it.
- Restart the dev server after changing `.env`.
- The current URL is the n8n **production** webhook (`/webhook/…`). It only responds while the workflow is activated in n8n. The **test** variant (`/webhook-test/…`) only accepts one request after "Execute workflow" / "Listen for test event" is clicked. Either way, an unregistered webhook returns HTTP 404 JSON with no CORS headers. The UI shows a test-mode hint only when the URL contains `/webhook-test/`.
- **Dev proxy:** under `npm run dev`, `src/config.ts` swaps `WEBHOOK_URL` for the same-origin path `/n8n-webhook`, and `vite.config.ts` proxies that path server-side to `VITE_N8N_WEBHOOK_URL`.
  - The proxy avoids CORS locally and lets the app see real n8n status codes. Without it, the CORS-less 404 surfaced in the browser only as a generic network error (fetch `TypeError`).
  - The production build calls the webhook directly, so CORS must be configured in n8n or on the host.
  - The path constant `/n8n-webhook` is duplicated in both files and must stay in sync. The 180 s proxy timeout mirrors `REQUEST_TIMEOUT_MS`.

## Architecture

The data flow is one-directional: hooks hold state, `App.tsx` wires them to presentational components, and only `services/n8nService.ts` touches the network.

- **`src/config.ts`**: single source for the webhook URL, accepted MIME types (`image/jpeg`, `image/webp`), the per-file size limit (8 MB, because n8n caps a request at about 16 MB and both files share one request) and the request timeout (180 s).
- **`src/services/n8nService.ts`** (`generateImage`): builds `FormData` with the field names `Bild1` and `Bild2`. Those names are a contract with the n8n workflow and are case-sensitive.
  - Never set the `Content-Type` header manually; the browser adds the multipart boundary.
  - The response must pass three checks: `response.ok`, a `Content-Type` of `image/jpeg` or `image/webp`, and a magic-byte check of the blob.
  - All failures throw `GenerationError`, whose message is shown verbatim in the UI. Keep these messages user-facing German text.
  - The timeout uses an internal `AbortController`, which also forwards an external abort signal.
- **`src/utils/validateImage.ts`**: `detectImageType` sniffs JPEG/WebP magic bytes. It is shared by input validation and response validation.
  - Input files with an empty or mismatched `file.type` are re-wrapped as a `File` with the detected MIME type, so the multipart part carries the correct content type.
- **`src/hooks/useImageFile.ts`**: one instance per upload slot.
  - It validates the file, then creates a preview object URL. The URL is revoked through effect cleanup keyed on the `image` object.
  - A `selectionId` ref discards results from stale async validations.
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
- A **Respond to Webhook** node returns a *Binary File* with `Content-Type: image/jpeg` or `image/webp`.
- "Allowed Origins (CORS)" must include the app's origin.

JSON, URL or async job-ID responses are explicitly out of scope for the MVP.
