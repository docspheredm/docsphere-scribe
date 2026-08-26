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
  backend and spend your Gemini quota. Every doctor enters this same code once in the extension's
  Settings page; requests without a matching `X-Access-Code` header are rejected with 401. This is
  a basic shared-secret gate, not per-user accounts — good enough to stop casual abuse for a small
  team, not a substitute for real auth/audit logging if you later need one per doctor.

## Chrome extension

The extension is a side panel version of the same app, so it stays open next to whatever tab a
doctor is working in.

### Build it

```
npm install
npm run build:extension
```

This produces `dist-extension/`, a ready-to-load unpacked extension (manifest, side panel,
settings page, background worker, icons).

### Load it locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist-extension` folder.
4. Click the extension's icon in the toolbar to open the side panel. On first install it also
   opens the **Settings** page automatically.

### One-time setup per doctor

In Settings, enter:

- **Server URL** — the URL of your deployed backend (e.g. `https://your-deployment.vercel.app`).
- **Access code** — the `ACCESS_CODE` value your organization set on the server.

These are stored in `chrome.storage.local`, local to that browser/profile only.

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