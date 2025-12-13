# DocSphere Scribe

An intelligent meeting assistant for DocSphere that captures system audio from Zoom or Google Meet, provides real-time transcription, and generates professional Minutes of Meeting (MoM) using Gemini.

## Features

- **System Audio Capture:** Records audio directly from browser tabs or applications (Windows).
- **Live Transcription:** Uses Gemini 2.5 Flash for real-time speech-to-text.
- **Auto-Summarization:** Generates formatted minutes including Action Items, Decisions, and Agenda.
- **PDF Export:** Download professional reports instantly.

## Setup

1. Clone the repository.
2. Install dependencies: `npm install`
3. Create a `.env` file in the root and add your key: `API_KEY=your_google_ai_key`
4. Run locally: `npm run dev`

## Deployment

When deploying to Vercel/Netlify, ensure you add the `API_KEY` in the project settings/environment variables.

## Verification

If you are reading this file on GitHub, your code has been successfully uploaded!
Version: v1.2