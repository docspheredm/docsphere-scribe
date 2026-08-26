// Shared config for running inside the Chrome extension (side panel / options page).
// Falls back gracefully when not running as an extension (e.g. the plain web build),
// where chrome.storage simply doesn't exist.

export interface ExtensionConfig {
  apiBaseUrl: string;
  accessCode: string;
}

const STORAGE_KEYS = { apiBaseUrl: 'apiBaseUrl', accessCode: 'accessCode' } as const;

export function isExtensionRuntime(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export async function getExtensionConfig(): Promise<ExtensionConfig> {
  if (!isExtensionRuntime()) {
    return { apiBaseUrl: '', accessCode: '' };
  }
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiBaseUrl, STORAGE_KEYS.accessCode]);
  return {
    apiBaseUrl: (stored[STORAGE_KEYS.apiBaseUrl] as string) || '',
    accessCode: (stored[STORAGE_KEYS.accessCode] as string) || '',
  };
}

export async function saveExtensionConfig(config: ExtensionConfig): Promise<void> {
  if (!isExtensionRuntime()) return;
  await chrome.storage.local.set({
    [STORAGE_KEYS.apiBaseUrl]: config.apiBaseUrl.trim().replace(/\/+$/, ''),
    [STORAGE_KEYS.accessCode]: config.accessCode.trim(),
  });
}
