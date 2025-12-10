# DocSphere Scribe

An intelligent meeting assistant for DocSphere that captures system audio from Zoom or Google Meet, provides real-time transcription, and generates professional Minutes of Meeting (MoM) using Gemini 2.5.

## Features

- **System Audio Capture:** Records audio directly from browser tabs or applications (Windows/Mac).
- **Live Transcription:** Uses Gemini 2.5 Flash Native Audio for real-time speech-to-text.
- **Auto-Summarization:** Generates formatted minutes including Action Items, Decisions, and Agenda.
- **PDF Export:** Download professional reports instantly.
- **PWA Support:** Installable as a standalone app on supported devices.

## Setup

1. **Clone the repository.**
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Environment Configuration:**
   Create a `.env` file in the root directory:
   ```env
   API_KEY=your_google_ai_key_here
   ```
   *Get your key from [AI Studio](https://aistudio.google.com).*

4. **Run locally:**
   ```bash
   npm run dev
   ```

## Usage Instructions

### Capturing Audio from Meetings

For the app to "hear" the meeting, you must share the audio correctly:

1. Click **"Select Screen & Start"**.
2. **For Google Meet/Zoom in Browser:**
   - Select the **Chrome Tab** tab.
   - Select the meeting tab.
   - **IMPORTANT:** Check the **"Share tab audio"** box in the bottom left.
3. **For Desktop Apps (Zoom/Teams on Windows):**
   - Select the **Entire Screen** tab.
   - **IMPORTANT:** Check the **"Share system audio"** box.
4. **DO NOT** select "Window". Browsers usually block audio sharing for single windows.

## Deployment Guide

This is a static React application. You can deploy it to any static site host (Vercel, Netlify, Cloudflare Pages).

### Option 1: Deploy to Vercel (Recommended)

1. Push your code to a Git repository (GitHub, GitLab, etc.).
2. Log in to [Vercel](https://vercel.com) and click **"Add New Project"**.
3. Import your repository.
4. **CRITICAL STEP:** In the "Configure Project" screen, expand the **"Environment Variables"** section.
   - Key: `API_KEY`
   - Value: `your_actual_google_api_key`
5. Click **Deploy**.

### Option 2: Deploy to Netlify

1. Push your code to a Git repository.
2. Log in to [Netlify](https://netlify.com) and click **"Add new site"** > **"Import an existing project"**.
3. Select your repository.
4. **CRITICAL STEP:** Click on **"Site settings"** > **"Environment variables"** (or add them during setup if prompted).
   - Key: `API_KEY`
   - Value: `your_actual_google_api_key`
5. Trigger a deployment.

### Note on API Security
Since this is a client-side application, your API Key will be embedded in the browser code.
- **Best Practice:** Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and edit your API key restrictions. Restrict the key to only accept requests from your deployed domain (e.g., `https://your-app.vercel.app`).

## Troubleshooting

- **No Transcript?** You likely didn't share audio. Stop the recording and try again, ensuring "Share tab/system audio" is checked.
- **Connection Error on Deploy?** Ensure you added the `API_KEY` environment variable in your hosting dashboard. The app needs this during the build process to configure the Gemini client.

---
Version: v1.2.2