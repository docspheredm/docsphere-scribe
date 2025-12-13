// Temporary global type declarations to avoid build errors.
// Add more `declare module` lines here if Vercel build shows other missing-module errors.

declare module '@google/genai';
declare module 'lucide-react';
declare module 'jspdf';
declare module 'some-untyped-package'; // remove or edit if not needed

// Allow reading process.env.API_KEY without TS errors
declare namespace NodeJS {
  interface ProcessEnv {
    API_KEY?: string;
    // add other environment variables your app needs, e.g.:
    // OTHER_KEY?: string;
  }
}

export {};
