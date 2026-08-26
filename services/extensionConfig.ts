// Shared config for running inside the Chrome extension (side panel / options page).
// Falls back gracefully when not running as an extension (e.g. the plain web build),
// where chrome.storage simply doesn't exist.

export interface ExtensionConfig {
  apiBaseUrl: string;
  accessCode: string;
}

const STORAGE_KEYS = { apiBaseUrl: 'apiBaseUrl', accessCode: 'accessCode' } as const;

// Baked in at build time (see .env / VITE_DEFAULT_* in the README) so a doctor can
// install the extension and use it immediately, with no setup. The Settings page
// still lets anyone override these per-browser if they need to point elsewhere.
const DEFAULT_API_BASE_URL = (import.meta.env.VITE_DEFAULT_API_BASE_URL as string | undefined)?.trim() || '';
const DEFAULT_ACCESS_CODE = (import.meta.env.VITE_DEFAULT_ACCESS_CODE as string | undefined)?.trim() || '';

export function isExtensionRuntime(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export function hasBuiltInDefaults(): boolean {
  return !!DEFAULT_API_BASE_URL;
}

export async function getExtensionConfig(): Promise<ExtensionConfig> {
  if (!isExtensionRuntime()) {
    return { apiBaseUrl: '', accessCode: '' };
  }
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiBaseUrl, STORAGE_KEYS.accessCode]);
  return {
    apiBaseUrl: (stored[STORAGE_KEYS.apiBaseUrl] as string) || DEFAULT_API_BASE_URL,
    accessCode: (stored[STORAGE_KEYS.accessCode] as string) || DEFAULT_ACCESS_CODE,
  };
}

export async function saveExtensionConfig(config: ExtensionConfig): Promise<void> {
  if (!isExtensionRuntime()) return;
  await chrome.storage.local.set({
    [STORAGE_KEYS.apiBaseUrl]: config.apiBaseUrl.trim().replace(/\/+$/, ''),
    [STORAGE_KEYS.accessCode]: config.accessCode.trim(),
  });
}
