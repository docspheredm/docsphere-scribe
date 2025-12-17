import React, { useState, useRef, useEffect } from 'react';
import { Mic, Settings, FileText, Download, StopCircle, PlayCircle, Loader2, Monitor, AlertCircle, CheckCircle2, Info, XCircle, Smartphone, Activity } from 'lucide-react';
import jsPDF from 'jspdf';
import { Button } from './components/Button';
import { LiveTranscriptionClient, generateMinutes } from './services/geminiService';
import { MeetingStatus, MeetingMinutes, AudioSourceType, BeforeInstallPromptEvent } from './types';

function App() {
  const [status, setStatus] = useState<MeetingStatus>(MeetingStatus.IDLE);
  const [transcript, setTranscript] = useState<string>("");
  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  const [sourceType, setSourceType] = useState<AudioSourceType>('SYSTEM_AUDIO');
  const [error, setError] = useState<string | null>(null);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  
  // PWA Install State
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  
  // Refs for managing the live client and preventing re-renders
  const liveClientRef = useRef<LiveTranscriptionClient | null>(null);
  const transcriptRef = useRef<string>("");

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setIsInstallable(false);
    setDeferredPrompt(null);
  };

  const handleStartRecording = async () => {
    setError(null);
    setVolumeLevel(0);
    try {
      let stream: MediaStream;
      
      if (sourceType === 'SYSTEM_AUDIO') {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true, 
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            } 
          });
        } catch (e) {
          throw new Error("Permission denied. Please select a Tab or Screen to share.");
        }

        if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error("NO AUDIO DETECTED. You likely selected 'Window' or forgot the checkbox. Please select 'Entire Screen' or 'Tab' and check 'Share system audio'.");
        }

      } else {
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true } 
        });
      }

      setStatus(MeetingStatus.RECORDING);
      
      liveClientRef.current = new LiveTranscriptionClient(
        (newText) => {
          setTranscript((prev) => prev + " " + newText);
        },
        (level) => {
          // Smooth out the visualizer
          setVolumeLevel(prev => (prev * 0.8) + (level * 0.2));
        },
        (err) => {
          console.error(err);
          setError(err.message);
          handleStopRecording();
        }
      );

      await liveClientRef.current.connectAndStart(stream);
      
      stream.getVideoTracks()[0]?.addEventListener('ended', handleStopRecording);
      stream.getAudioTracks()[0]?.addEventListener('ended', handleStopRecording);

    } catch (e: any) {
      setError(e.message || "Failed to start recording");
      setStatus(MeetingStatus.IDLE);
    }
  };

  const handleStopRecording = async () => {
    if (liveClientRef.current) {
      await liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }
    setStatus(MeetingStatus.PROCESSING);
    
    // We allow shorter transcripts for testing, but in production this check is good
    if (transcriptRef.current.trim().length < 5) {
        setError("Transcript was empty. Did you share the correct audio source?");
        setStatus(MeetingStatus.IDLE);
        return;
    }

    try {
      const generatedMinutes = await generateMinutes(transcriptRef.current);
      setMinutes(generatedMinutes);
      setStatus(MeetingStatus.REVIEWING);
    } catch (e) {
      console.error(e);
      setError("Failed to generate minutes. Please try again.");
      setStatus(MeetingStatus.IDLE);
    }
  };

  const handleReset = () => {
    setTranscript("");
    setMinutes(null);
    setStatus(MeetingStatus.IDLE);
    setError(null);
  };

  const handleDownloadPDF = () => {
    if (!minutes) return;

    const doc = new jsPDF();
    const margin = 20;
    let y = margin;

    const addText = (text: string, fontSize: number = 12, fontStyle: string = 'normal') => {
      doc.setFont("helvetica", fontStyle);
      doc.setFontSize(fontSize);
      const splitText = doc.splitTextToSize(text, 170);
      
      if (y + (splitText.length * 7) > 280) {
        doc.addPage();
        y = margin;
      }
      
      doc.text(splitText, margin, y);
      y += (splitText.length * 7) + 5;
    };

    addText(minutes.title || "Meeting Minutes", 20, "bold");
    addText(`Date: ${minutes.date}`, 12);
    y += 5;

    if (minutes.attendees?.length > 0) {
      addText("Attendees:", 14, "bold");
      minutes.attendees.forEach(att => addText(`• ${att}`, 12));
      y += 5;
    }

    if (minutes.agenda?.length > 0) {
      addText("Agenda:", 14, "bold");
      minutes.agenda.forEach(item => addText(`• ${item}`, 12));
      y += 5;
    }

    if (minutes.discussionPoints?.length > 0) {
      addText("Key Discussion Points:", 14, "bold");
      minutes.discussionPoints.forEach(pt => addText(`• ${pt}`, 12));
      y += 5;
    }

    if (minutes.decisions?.length > 0) {
      addText("Decisions Made:", 14, "bold");
      minutes.decisions.forEach(d => addText(`• ${d}`, 12));
      y += 5;
    }

    if (minutes.actionItems?.length > 0) {
      addText("Action Items:", 14, "bold");
      minutes.actionItems.forEach(item => {
        addText(`[ ] ${item.task} (${item.assignee}) - Due: ${item.deadline || 'N/A'}`, 12);
      });
    }

    doc.save("meeting-minutes.pdf");
  };

  const handleDownloadDOC = () => {
    if (!minutes) return;

    const content = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${minutes.title}</title></head>
      <body>
        <h1>${minutes.title}</h1>
        <p><strong>Date:</strong> ${minutes.date}</p>
        
        <h2>Attendees</h2>
        <ul>${minutes.attendees.map(a => `<li>${a}</li>`).join('')}</ul>

        <h2>Agenda</h2>
        <ul>${minutes.agenda.map(a => `<li>${a}</li>`).join('')}</ul>

        <h2>Discussion Points</h2>
        <ul>${minutes.discussionPoints.map(a => `<li>${a}</li>`).join('')}</ul>

        <h2>Decisions</h2>
        <ul>${minutes.decisions.map(a => `<li>${a}</li>`).join('')}</ul>

        <h2>Action Items</h2>
        <ul>${minutes.actionItems.map(a => `<li><strong>${a.task}</strong> (${a.assignee}) - Due: ${a.deadline || 'N/A'}</li>`).join('')}</ul>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', content], {
      type: 'application/msword'
    });
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'meeting-minutes.doc';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Render Functions ---

  const renderIdle = () => (
    <div className="flex flex-col items-center justify-center space-y-8 animate-fade-in py-12">
      <div className="text-center space-y-4 max-w-2xl">
        <h1 className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
          DocSphere Scribe
        </h1>
        <p className="text-slate-400 text-lg">
          Your intelligent meeting assistant. Capture audio directly from Zoom or Google Meet, 
          transcribe in real-time, and generate professional minutes instantly.
        </p>
      </div>

      <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 backdrop-blur-sm w-full max-w-md shadow-xl">
        <h3 className="text-slate-200 font-semibold mb-6 flex items-center gap-2 border-b border-slate-700 pb-4">
          <Settings size={20} className="text-blue-400" /> Configuration
        </h3>
        
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-3">Audio Source</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSourceType('SYSTEM_AUDIO')}
                className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all ${
                  sourceType === 'SYSTEM_AUDIO' 
                    ? 'bg-blue-600/20 border-blue-500 text-blue-200 shadow-inner' 
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:bg-slate-700/50'
                }`}
              >
                <Monitor size={24} />
                <span className="text-sm font-medium">System Audio</span>
              </button>
              <button
                onClick={() => setSourceType('MICROPHONE')}
                className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all ${
                  sourceType === 'MICROPHONE' 
                    ? 'bg-blue-600/20 border-blue-500 text-blue-200 shadow-inner' 
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:bg-slate-700/50'
                }`}
              >
                <Mic size={24} />
                <span className="text-sm font-medium">Microphone</span>
              </button>
            </div>
          </div>

          <Button 
            onClick={handleStartRecording} 
            className="w-full h-14 text-lg font-semibold shadow-blue-900/50"
          >
            <PlayCircle size={24} /> 
            {sourceType === 'SYSTEM_AUDIO' ? 'Select Screen to Record' : 'Start Recording'}
          </Button>
        </div>
      </div>
      
      {sourceType === 'SYSTEM_AUDIO' && (
         <div className="flex gap-2 text-sm text-slate-500 bg-slate-900/50 px-4 py-2 rounded-full border border-slate-800">
            <Info size={16} />
            <span>Remember to check <strong>"Share system audio"</strong> in the popup</span>
         </div>
      )}
    </div>
  );

  const renderRecording = () => (
    <div className="flex flex-col h-full space-y-6">
      {/* Recording Status Bar */}
      <div className="flex items-center justify-between bg-slate-800/80 p-4 rounded-xl border border-slate-700 shadow-lg backdrop-blur-md sticky top-4 z-10">
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 rounded-lg border border-red-500/20">
                <div className="relative">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-ping absolute"></div>
                    <div className="w-3 h-3 bg-red-500 rounded-full relative"></div>
                </div>
                <span className="font-mono text-red-200 font-medium">REC</span>
            </div>
            
            {/* Audio Visualizer */}
            <div className="flex items-center gap-2">
                <div className="flex gap-0.5 items-end h-8 w-32 bg-slate-900/50 rounded px-1 pb-1">
                    {[...Array(10)].map((_, i) => (
                        <div 
                            key={i}
                            className={`flex-1 rounded-t-sm transition-all duration-75 ${
                                (volumeLevel * 50) > i ? 'bg-emerald-400' : 'bg-slate-700'
                            }`}
                            style={{ height: `${Math.min(100, Math.max(10, (volumeLevel * 500) - (i * 10)))}%` }}
                        ></div>
                    ))}
                </div>
                {volumeLevel < 0.01 && (
                     <span className="text-xs text-amber-400 flex items-center gap-1 animate-pulse">
                        <AlertCircle size={12} /> No Audio?
                     </span>
                )}
            </div>
        </div>
        
        <Button variant="danger" onClick={handleStopRecording}>
          <StopCircle size={20} /> End Meeting & Generate Options
        </Button>
      </div>

      {/* Main Transcript Area */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-8 shadow-xl overflow-hidden flex flex-col relative min-h-[500px]">
        <h3 className="text-slate-500 font-bold mb-6 uppercase tracking-wider text-sm border-b pb-4 flex items-center gap-2">
            <Activity size={18} className="text-blue-500" />
            Live Transcription
        </h3>
        <div className="flex-1 overflow-y-auto space-y-4">
          {transcript ? (
             <p className="text-slate-800 text-xl leading-8 whitespace-pre-wrap font-medium">{transcript}</p>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
               <Loader2 size={48} className="animate-spin text-slate-300" />
               <p className="text-lg">Waiting for speech...</p>
               {volumeLevel < 0.01 && (
                 <div className="text-sm bg-red-50 text-red-600 p-4 rounded-lg max-w-md text-center">
                    If people are talking but this bar is flat, stop and try again. 
                    Ensure you check <strong>"Share system audio"</strong> when selecting the screen.
                 </div>
               )}
            </div>
          )}
          <div className="h-12" /> 
        </div>
      </div>
    </div>
  );

  const renderProcessing = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] space-y-6">
      <div className="relative">
        <div className="absolute inset-0 bg-blue-500 blur-xl opacity-20 rounded-full"></div>
        <Loader2 size={64} className="text-blue-400 animate-spin relative z-10" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-white">Generating Minutes</h2>
        <p className="text-slate-400">Processing transcript and creating export formats...</p>
      </div>
    </div>
  );

  const renderReviewing = () => (
    <div className="flex flex-col items-center justify-center py-12 space-y-8 animate-fade-in">
       
       <div className="text-center space-y-2">
           <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500/10 rounded-full text-emerald-400 mb-4">
               <CheckCircle2 size={32} />
           </div>
           <h2 className="text-3xl font-bold text-white">Meeting Ready</h2>
           <p className="text-slate-400">Your meeting has been transcribed and processed.</p>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
           <button 
                onClick={handleDownloadDOC}
                className="group p-6 bg-slate-800 hover:bg-blue-600 border border-slate-700 hover:border-blue-500 rounded-2xl transition-all duration-300 flex flex-col items-center gap-4 shadow-xl hover:shadow-2xl hover:-translate-y-1"
           >
               <div className="w-12 h-12 bg-blue-500/20 group-hover:bg-white/20 rounded-xl flex items-center justify-center text-blue-400 group-hover:text-white transition-colors">
                   <FileText size={24} />
               </div>
               <div className="text-center">
                   <h3 className="text-lg font-bold text-slate-100 group-hover:text-white">Download as DOC</h3>
                   <p className="text-sm text-slate-400 group-hover:text-blue-100 mt-1">Editable Word Document</p>
               </div>
           </button>

           <button 
                onClick={handleDownloadPDF}
                className="group p-6 bg-slate-800 hover:bg-red-600 border border-slate-700 hover:border-red-500 rounded-2xl transition-all duration-300 flex flex-col items-center gap-4 shadow-xl hover:shadow-2xl hover:-translate-y-1"
           >
               <div className="w-12 h-12 bg-red-500/20 group-hover:bg-white/20 rounded-xl flex items-center justify-center text-red-400 group-hover:text-white transition-colors">
                   <Download size={24} />
               </div>
               <div className="text-center">
                   <h3 className="text-lg font-bold text-slate-100 group-hover:text-white">Download as PDF</h3>
                   <p className="text-sm text-slate-400 group-hover:text-red-100 mt-1">Professional Format</p>
               </div>
           </button>
       </div>

       <Button variant="ghost" onClick={handleReset} className="mt-8">
           Start New Meeting
       </Button>

       {/* Preview (Collapsible or just below) */}
       <div className="w-full max-w-4xl mt-12 opacity-75 hover:opacity-100 transition-opacity">
           <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
               <h3 className="text-slate-500 font-medium mb-4 uppercase tracking-wider text-xs">Preview Content</h3>
               <div className="prose prose-invert max-w-none">
                    <h3 className="text-xl font-bold text-white">{minutes?.title}</h3>
                    <div className="text-slate-300 space-y-2 mt-4">
                        <p><strong>Decisions:</strong> {minutes?.decisions?.join(', ')}</p>
                        <p><strong>Action Items:</strong> {minutes?.actionItems?.length} items recorded</p>
                    </div>
               </div>
           </div>
       </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 font-sans selection:bg-blue-500/30">
      <div className="max-w-7xl mx-auto px-4 py-6 min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between mb-8 opacity-80 hover:opacity-100 transition-opacity">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-emerald-500 rounded-lg flex items-center justify-center">
              <span className="font-bold text-white">D</span>
            </div>
            <span className="font-semibold text-lg tracking-tight">DocSphere</span>
          </div>
          
          <div className="flex items-center gap-4">
            {isInstallable && (
              <button 
                onClick={handleInstallClick}
                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors animate-pulse"
              >
                <Smartphone size={16} />
                Install App
              </button>
            )}
            <div className="text-xs text-slate-500 font-mono flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
               Live Transcription Ready
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative">
          {error && (
            <div className="absolute top-0 left-0 right-0 z-50 bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-xl flex items-center justify-between mb-6 backdrop-blur-md shadow-lg animate-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="mt-0.5 shrink-0" />
                <div className="whitespace-pre-wrap">{error}</div>
              </div>
              <button onClick={() => setError(null)} className="text-red-300 hover:text-white p-2">
                  <XCircle size={20} />
              </button>
            </div>
          )}

          {status === MeetingStatus.IDLE && renderIdle()}
          {status === MeetingStatus.RECORDING && renderRecording()}
          {status === MeetingStatus.PROCESSING && renderProcessing()}
          {status === MeetingStatus.REVIEWING && renderReviewing()}
        </main>
      </div>
    </div>
  );
}

export default App;