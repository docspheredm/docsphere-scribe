import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Upload, Square, FileAudio, Clipboard, ClipboardCheck, RotateCcw, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type AppState = 'idle' | 'recording' | 'captured' | 'transcribing' | 'done' | 'error';

interface TranscriptTurn {
  speaker: string;
  text: string;
}

interface ICD10Code {
  code: string;
  description: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  'Sending audio to Gemini AI…',
  'Transcribing conversation…',
  'Identifying speaker turns…',
  'Extracting clinical content…',
  'Looking up ICD-10 codes…',
  'Almost there — longer recordings take up to a minute…',
];

const MAX_SAFE_SECONDS = 600; // 10 min, warn after this

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (data:audio/webm;base64,...)
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getSpeakerColor(speaker: string): string {
  const s = speaker.toLowerCase();
  if (s.includes('doctor') || s.includes('speaker 1')) return '#0891b2';
  return '#64748b';
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string>('audio/webm');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [icd10Codes, setIcd10Codes] = useState<ICD10Code[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [codesCopied, setCodesCopied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const loadingIntervalRef = useRef<number | null>(null);

  // Cycle loading messages while transcribing
  useEffect(() => {
    if (appState === 'transcribing') {
      setLoadingMsgIndex(0);
      loadingIntervalRef.current = window.setInterval(() => {
        setLoadingMsgIndex(i => (i + 1) % LOADING_MESSAGES.length);
      }, 3500);
    } else {
      if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    }
    return () => { if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current); };
  }, [appState]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ── Recording ──────────────────────────────────────────────────────────────

  const startRecording = async () => {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Pick a supported mimeType
      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const mimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setAudioMimeType(recorder.mimeType || 'audio/webm');
        setAudioBlob(blob);
        setAppState('captured');
      };

      recorder.start(1000); // collect chunks every second
      mediaRecorderRef.current = recorder;

      setRecordingSeconds(0);
      setAppState('recording');
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);

    } catch (err: any) {
      const msg = err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow mic access in your browser and try again.'
        : `Could not start recording: ${err.message}`;
      setErrorMessage(msg);
    }
  };

  const stopRecording = () => {
    stopTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    setAudioBlob(file);
    setAudioMimeType(file.type || 'audio/mpeg');
    setRecordingSeconds(0);
    setAppState('captured');
    // Reset the input so the same file can be re-selected after a clear
    e.target.value = '';
  };

  // ── Transcribe ─────────────────────────────────────────────────────────────

  const transcribe = async () => {
    if (!audioBlob) return;
    setAppState('transcribing');
    setErrorMessage(null);

    try {
      const base64 = await blobToBase64(audioBlob);

      // Warn if payload is large (base64 adds ~33% overhead; 4.5MB limit on Vercel Hobby)
      const estimatedBytes = base64.length * 0.75;
      if (estimatedBytes > 4_000_000) {
        setErrorMessage(
          'Warning: this audio file is large and may exceed the 4.5 MB upload limit on the free Vercel plan. ' +
          'If this fails, try a shorter recording (under 10 minutes at typical voice quality).'
        );
      }

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioData: base64, mimeType: audioMimeType }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server error ${response.status}`);
      }

      setTranscript(data.transcript || []);
      setIcd10Codes(data.icd10_codes || []);
      setAppState('done');

    } catch (err: any) {
      setErrorMessage(err.message || 'Transcription failed. Please try again.');
      setAppState('error');
    }
  };

  // ── Clear ──────────────────────────────────────────────────────────────────

  const clearSession = () => {
    stopTimer();
    setAppState('idle');
    setAudioBlob(null);
    setAudioMimeType('audio/webm');
    setRecordingSeconds(0);
    setTranscript([]);
    setIcd10Codes([]);
    setErrorMessage(null);
    setTranscriptCopied(false);
    setCodesCopied(false);
  };

  // ── Copy ───────────────────────────────────────────────────────────────────

  const copyTranscript = async () => {
    const text = transcript.map(t => `${t.speaker}: ${t.text}`).join('\n\n');
    await navigator.clipboard.writeText(text);
    setTranscriptCopied(true);
    setTimeout(() => setTranscriptCopied(false), 2000);
  };

  const copyCodes = async () => {
    const text = icd10Codes.map(c => `${c.code} — ${c.description}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCodesCopied(true);
    setTimeout(() => setCodesCopied(false), 2000);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: '#0a1628', color: '#f1f5f9' }}>

      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-sm"
               style={{ backgroundColor: '#0891b2' }}>D</div>
          <div>
            <span className="font-semibold text-white tracking-tight">DocSphere</span>
            <span className="text-slate-400 ml-2 text-sm">Transcribe</span>
          </div>
        </div>
        <span className="text-xs text-slate-500 hidden sm:block">
          Audio and transcripts are not stored. Closing this page permanently deletes everything.
        </span>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-10">

        {/* Privacy notice on mobile */}
        <p className="text-xs text-slate-500 text-center mb-8 sm:hidden">
          Audio and transcripts are processed for this session only and are not stored.
          Closing or refreshing this page permanently deletes everything.
        </p>

        {/* ── IDLE ── */}
        {appState === 'idle' && (
          <div className="space-y-8">
            <div className="text-center space-y-3">
              <h1 className="text-4xl font-bold text-white">Medical Transcription</h1>
              <p className="text-slate-400 max-w-lg mx-auto">
                Record or upload a consultation. Gemini AI will transcribe the conversation with
                speaker labels and extract relevant ICD-10 diagnosis codes.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-10">
              {/* Record card */}
              <button
                onClick={startRecording}
                className="group p-8 rounded-2xl border border-slate-700 hover:border-cyan-500 transition-all duration-200 text-left"
                style={{ backgroundColor: '#0d1f38' }}
              >
                <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-5 transition-colors"
                     style={{ backgroundColor: '#0891b210', border: '1px solid #0891b230' }}>
                  <Mic size={28} style={{ color: '#0891b2' }} />
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">Record</h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Start the microphone and record a live consultation. Click Stop when done.
                </p>
              </button>

              {/* Upload card */}
              <label
                className="group p-8 rounded-2xl border border-slate-700 hover:border-cyan-500 transition-all duration-200 cursor-pointer block"
                style={{ backgroundColor: '#0d1f38' }}
              >
                <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-5"
                     style={{ backgroundColor: '#0891b210', border: '1px solid #0891b230' }}>
                  <Upload size={28} style={{ color: '#0891b2' }} />
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">Upload Audio</h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Upload an existing audio file (mp3, wav, m4a, webm). Accepts most common formats.
                </p>
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
            </div>

            <p className="text-center text-xs text-slate-600">
              Audio and transcripts are processed for this session only and are not stored.
              Closing or refreshing this page permanently deletes everything.
            </p>
          </div>
        )}

        {/* ── RECORDING ── */}
        {appState === 'recording' && (
          <div className="flex flex-col items-center justify-center space-y-10 py-12">
            {/* Pulsing indicator */}
            <div className="relative flex items-center justify-center">
              <div className="absolute w-32 h-32 rounded-full animate-ping opacity-20"
                   style={{ backgroundColor: '#dc2626' }} />
              <div className="absolute w-24 h-24 rounded-full animate-ping opacity-10 animation-delay-300"
                   style={{ backgroundColor: '#dc2626', animationDelay: '0.3s' }} />
              <div className="w-16 h-16 rounded-full flex items-center justify-center relative z-10"
                   style={{ backgroundColor: '#dc2626' }}>
                <Mic size={28} className="text-white" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <div className="text-5xl font-mono font-bold text-white">{formatTime(recordingSeconds)}</div>
              <p className="text-slate-400">Recording in progress…</p>
              {recordingSeconds > MAX_SAFE_SECONDS && (
                <p className="text-amber-400 text-sm">
                  Long recording detected. Files over ~10 minutes may exceed the 4.5 MB upload limit.
                </p>
              )}
            </div>

            <button
              onClick={stopRecording}
              className="flex items-center gap-3 px-8 py-4 rounded-xl font-semibold text-white transition-all hover:opacity-90"
              style={{ backgroundColor: '#dc2626' }}
            >
              <Square size={20} fill="white" />
              Stop Recording
            </button>
          </div>
        )}

        {/* ── CAPTURED ── */}
        {appState === 'captured' && audioBlob && (
          <div className="flex flex-col items-center space-y-8 py-8">
            <div className="p-8 rounded-2xl border border-slate-700 w-full max-w-md text-center space-y-4"
                 style={{ backgroundColor: '#0d1f38' }}>
              <div className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto"
                   style={{ backgroundColor: '#0891b210', border: '1px solid #0891b230' }}>
                <FileAudio size={32} style={{ color: '#0891b2' }} />
              </div>
              <div>
                <p className="text-white font-semibold">Audio ready</p>
                <p className="text-slate-400 text-sm mt-1">
                  {recordingSeconds > 0
                    ? `Recorded: ${formatTime(recordingSeconds)}`
                    : `File: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB`}
                </p>
                <p className="text-slate-500 text-xs mt-1">{audioMimeType}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
              <button
                onClick={transcribe}
                className="flex-1 py-4 px-6 rounded-xl font-semibold text-white transition-all hover:opacity-90 flex items-center justify-center gap-2"
                style={{ backgroundColor: '#0891b2' }}
              >
                Transcribe
              </button>
              <button
                onClick={clearSession}
                className="py-4 px-6 rounded-xl font-medium text-slate-400 border border-slate-700 hover:border-slate-600 transition-all flex items-center justify-center gap-2"
                style={{ backgroundColor: '#0d1f38' }}
              >
                <RotateCcw size={16} />
                Start over
              </button>
            </div>
          </div>
        )}

        {/* ── TRANSCRIBING ── */}
        {appState === 'transcribing' && (
          <div className="flex flex-col items-center justify-center space-y-8 py-16">
            <div className="relative">
              <Loader2 size={56} className="animate-spin" style={{ color: '#0891b2' }} />
            </div>
            <div className="text-center space-y-3 max-w-sm">
              <p className="text-xl font-semibold text-white">Processing your audio</p>
              <p className="text-slate-400 text-sm min-h-[40px] transition-all duration-500">
                {LOADING_MESSAGES[loadingMsgIndex]}
              </p>
              <p className="text-slate-500 text-xs">
                Short consultations: ~15 seconds. Longer recordings: up to 60 seconds.
                This page will not freeze — keep waiting.
              </p>
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {appState === 'done' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={24} style={{ color: '#22c55e' }} />
                <h2 className="text-xl font-semibold text-white">Transcription complete</h2>
              </div>
              <button
                onClick={clearSession}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-600"
                style={{ backgroundColor: '#0d1f38' }}
              >
                <RotateCcw size={14} />
                New session
              </button>
            </div>

            {/* Transcript */}
            <div className="rounded-2xl border border-slate-700 overflow-hidden" style={{ backgroundColor: '#0d1f38' }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                <h3 className="font-semibold text-white">Transcript</h3>
                <button
                  onClick={copyTranscript}
                  className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: transcriptCopied ? '#22c55e' : '#94a3b8', backgroundColor: '#ffffff08' }}
                >
                  {transcriptCopied ? <ClipboardCheck size={15} /> : <Clipboard size={15} />}
                  {transcriptCopied ? 'Copied!' : 'Copy text'}
                </button>
              </div>
              <div className="p-6 max-h-96 overflow-y-auto space-y-5">
                {transcript.length === 0 ? (
                  <p className="text-slate-500 italic text-sm">No transcript was returned. The audio may contain no speech.</p>
                ) : transcript.map((turn, i) => (
                  <div key={i} className="flex gap-3">
                    <span
                      className="font-semibold text-sm shrink-0 w-20 pt-0.5"
                      style={{ color: getSpeakerColor(turn.speaker) }}
                    >
                      {turn.speaker}
                    </span>
                    <p className="text-slate-200 text-sm leading-relaxed">{turn.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ICD-10 Codes */}
            <div className="rounded-2xl border border-slate-700 overflow-hidden" style={{ backgroundColor: '#0d1f38' }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                <h3 className="font-semibold text-white">ICD-10 Codes</h3>
                {icd10Codes.length > 0 && (
                  <button
                    onClick={copyCodes}
                    className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors"
                    style={{ color: codesCopied ? '#22c55e' : '#94a3b8', backgroundColor: '#ffffff08' }}
                  >
                    {codesCopied ? <ClipboardCheck size={15} /> : <Clipboard size={15} />}
                    {codesCopied ? 'Copied!' : 'Copy codes'}
                  </button>
                )}
              </div>
              <div className="p-6">
                {icd10Codes.length === 0 ? (
                  <p className="text-slate-500 italic text-sm">
                    No ICD-10 codes were confidently identified from this conversation.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {icd10Codes.map((code, i) => (
                      <div key={i} className="flex items-start gap-4 py-3 border-b border-slate-800 last:border-0">
                        <span
                          className="font-mono font-bold text-sm shrink-0 px-2 py-0.5 rounded"
                          style={{ backgroundColor: '#0891b215', color: '#0891b2', border: '1px solid #0891b230' }}
                        >
                          {code.code}
                        </span>
                        <span className="text-slate-200 text-sm leading-relaxed">{code.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <p className="text-center text-xs text-slate-600">
              This transcript exists only in your browser session. Refresh or close this tab to permanently delete it.
            </p>
          </div>
        )}

        {/* ── ERROR ── */}
        {appState === 'error' && (
          <div className="flex flex-col items-center space-y-6 py-12">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
                 style={{ backgroundColor: '#dc262615' }}>
              <AlertCircle size={32} style={{ color: '#dc2626' }} />
            </div>
            <div className="text-center space-y-2 max-w-md">
              <p className="text-white font-semibold text-lg">Transcription failed</p>
              <p className="text-slate-400 text-sm leading-relaxed">{errorMessage}</p>
            </div>
            <button
              onClick={clearSession}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-white transition-all hover:opacity-90"
              style={{ backgroundColor: '#0891b2' }}
            >
              <RotateCcw size={16} />
              Try again
            </button>
          </div>
        )}

        {/* Inline warning (shown on captured/transcribing states if large file) */}
        {errorMessage && appState !== 'error' && (
          <div className="mt-4 flex gap-3 items-start p-4 rounded-xl border border-amber-500/30 text-amber-300 text-sm"
               style={{ backgroundColor: '#78350f15' }}>
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <p>{errorMessage}</p>
          </div>
        )}

      </main>
    </div>
  );
}
