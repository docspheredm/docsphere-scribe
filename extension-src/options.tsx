import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { CheckCircle2 } from 'lucide-react';
import { getExtensionConfig, saveExtensionConfig, hasBuiltInDefaults } from '../services/extensionConfig';
import '../index.css';

function OptionsPage() {
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getExtensionConfig().then((config) => {
      setApiBaseUrl(config.apiBaseUrl);
      setAccessCode(config.accessCode);
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveExtensionConfig({ apiBaseUrl, accessCode });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen font-sans flex items-start justify-center py-16 px-4" style={{ backgroundColor: '#0a1628', color: '#f1f5f9' }}>
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">DocSphere Transcribe</h1>
          <p className="text-slate-400 text-sm mt-1">Connect this extension to your organization's transcription server.</p>
          {hasBuiltInDefaults() && (
            <p className="text-xs text-cyan-400 mt-2">
              This extension came pre-configured for your organization — you don't need to change anything here
              unless you were told to use a different server.
            </p>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-5 p-6 rounded-2xl border border-slate-700" style={{ backgroundColor: '#0d1f38' }}>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">Server URL</label>
            <input
              type="url"
              required
              placeholder="https://your-deployment.vercel.app"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-600 text-white text-sm outline-none focus:border-cyan-500"
              style={{ backgroundColor: '#0a1628' }}
            />
            <p className="text-xs text-slate-500">The URL of your organization's deployed DocSphere Scribe backend.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">Access code</label>
            <input
              type="password"
              required
              placeholder="Provided by your organization"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-600 text-white text-sm outline-none focus:border-cyan-500"
              style={{ backgroundColor: '#0a1628' }}
            />
            <p className="text-xs text-slate-500">A shared code your organization set on the server (ACCESS_CODE). Stored only in this browser.</p>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90 flex items-center justify-center gap-2"
            style={{ backgroundColor: '#0891b2' }}
          >
            {saved ? (<><CheckCircle2 size={16} /> Saved</>) : 'Save settings'}
          </button>
        </form>

        <p className="text-xs text-slate-600 text-center">
          Audio is sent to your organization's server for transcription and is not stored by this extension.
        </p>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <OptionsPage />
  </React.StrictMode>
);
