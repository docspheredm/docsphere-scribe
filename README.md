# DocSphere Scribe

An AI medical transcription assistant. Record or upload a consultation and get a speaker-labeled
transcript plus suggested ICD-10 codes, powered by Gemini. Ships as both a web app and a Chrome
extension so a clinic can roll it out to many doctors without anyone touching a server key.

## Features

- **Record or upload:** Capture from the microphone or upload an existing audio file.
- **Transcription:** Uses Gemini 2.5 Flash for speech-to-text with Doctor/Patient speaker labels.
- **ICD-10 extraction:** Pulls out diagnosis codes that are clearly supported by the conversation.
- **No storage:** Audio and transcripts live only in the browser session/side panel; closing it deletes everything.

## Architecture

The Gemini API key lives only in one server-side function (`api/transcribe.js`), never in client
code. Both the web app and the Chrome extension call that same backend over HTTPS, so the key is
never shipped to a browser or an extension bundle that could be inspected or reverse-engineered.

## Web app setup

1. Clone the repository.
2. Install dependencies: `npm install`
3. Create a `.env` file in the root and add your key: `API_KEY=your_google_ai_key`
4. Run locally: `npm run dev`

## Deployment (backend, shared by web app + extension)

Deploy to Vercel (or any host that can run `api/transcribe.js` as a serverless function) and set
these environment variables in the project settings:

- `GEMINI_API_KEY` (or `API_KEY`) — your Google AI key. **Required.**
- `ACCESS_CODE` — a shared secret string. **Strongly recommended** once you distribute the Chrome
  extension to more than one person: without it, anyone who installs the extension can call your
  backend and spend your Gemini quota. The extension build bakes this same code in (see below), so
  requests carry it automatically; requests without a matching `X-Access-Code` header are rejected
  with 401. This is a basic shared-secret gate, not per-user accounts and not a real secret once
  it's built into a Chrome extension anyone can unzip and read — good enough to stop the general
  public from hitting your backend and running up your bill, not a substitute for real per-doctor
  auth/audit logging if you need that later.

## Chrome extension

The extension is a side panel version of the same app, so it stays open next to whatever tab a
doctor is working in.

### Build it

Copy `.env.example` to `.env` and fill in the two `VITE_DEFAULT_*` values with your deployed
backend's URL and its `ACCESS_CODE`:

```
cp .env.example .env
# edit .env: VITE_DEFAULT_API_BASE_URL, VITE_DEFAULT_ACCESS_CODE
npm install
npm run build:extension
```

This bakes your server URL and access code into the build, so **doctors install it and use it
immediately — no setup screen, same as installing any consumer extension like Grammarly.** They
never see or type a server address or access code. This produces `dist-extension/`, a ready-to-load
unpacked extension (manifest, side panel, settings page, background worker, icons).

If you skip the `.env` step, the extension still builds, but each doctor will have to manually
enter a server URL and access code in Settings before it works — useful only for testing against
different backends yourself.

### Load it locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist-extension` folder.
4. Click the extension's icon in the toolbar to open the side panel — it works immediately if you
   set the `.env` values above.

### Settings (optional, for overrides only)

The gear icon in the side panel opens Settings, pre-filled with the built-in server URL and access
code. Nobody needs to touch it — it's there only for the rare case where someone needs to point at
a different server. Anything entered there is stored in `chrome.storage.local`, local to that
browser/profile, and overrides the built-in default.

### Distributing to many doctors

- **Small team / internal only:** zip `dist-extension/` and share it, or publish it **unlisted**
  on the Chrome Web Store and share the install link — avoids a public listing while still giving
  doctors auto-updates.
- **Public listing:** publish normally via the [Chrome Web Store Developer
  Dashboard](https://chrome.google.com/webstore/devconsole). You'll need a privacy policy describing
  that consultation audio is sent to your Gemini backend for transcription and is not otherwise
  stored, plus screenshots and a listing description.
- Bump `"version"` in `extension-src/manifest.json` on each release before rebuilding, so the Web
  Store treats it as an update.

### A note on PHI / HIPAA

This app transmits consultation audio to Google's Gemini API for transcription. Before rolling
this out with real patients, confirm your Google AI usage is covered by a Business
Associate Agreement (BAA) appropriate for PHI, and review Gemini's data-handling terms for your
plan. The access-code gate above stops casual misuse of your backend, but it is not itself a
HIPAA control.