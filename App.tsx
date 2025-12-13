import React, { useState, useRef, useEffect } from 'react';
import { Mic, Settings, FileText, Download, StopCircle, PlayCircle, Loader2, Monitor, AlertCircle, CheckCircle2, Info, XCircle, Smartphone } from 'lucide-react';
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
  
  // PWA Install State
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  
  // Refs for managing the live client and preventing re-renders
  const liveClientRef = useRef<LiveTranscriptionClient | null>(null);
  const transcriptRef = useRef<string>("");

  // Update visual transcript state less frequently if needed, 
  // but for now we sync directly.
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  // Handle PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      setIsInstallable(false);
    } else {
      console.log('User dismissed the install prompt');
    }
    setDeferredPrompt(null);
  };

  const handleStartRecording = async () => {
    setError(null);
    try {
      let stream: MediaStream;
      
      if (sourceType === 'SYSTEM_AUDIO') {
        // System audio capture (requires Tab/Window sharing with audio checked)
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true, // Required for system audio in most browsers
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            } 
          });
        } catch (e) {
          throw new Error("Permission denied or cancelled. Please share a tab/window with audio enabled.");
        }

        // CRITICAL CHECK: Did the user actually share audio?
        // If they chose "Window" or forgot the checkbox, audio tracks will be empty.
        if (stream.getAudioTracks().length === 0) {
            // Stop the video track immediately to clean up
            stream.getTracks().forEach(t => t.stop());
            
            // Create a specific helpful error message
            throw new Error("NO AUDIO DETECTED. You likely selected 'Window' or forgot the checkbox.\n\nSOLUTION: Select 'Entire Screen' or 'Tab' and ensure 'Share system audio' is checked.");
        }

      } else {
        // Microphone capture
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            } 
        });
      }

      setStatus(MeetingStatus.RECORDING);
      
      liveClientRef.current = new LiveTranscriptionClient(
        (newText) => {
          setTranscript((prev) => prev + " " + newText);
        },
        (err) => {
          console.error(err);
          setError(err.message);
          handleStopRecording();
        }
      );

      await liveClientRef.current.connectAndStart(stream);
      
      // Handle user stopping the stream via browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          handleStopRecording();
      });
      
      // Also handle if the audio track stops unexpectedly
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          handleStopRecording();
      });

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
    
    if (transcriptRef.current.trim().length < 10) {
        setError("Transcript too short to generate minutes.");
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

    // Helper for adding text
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

    doc.save("doc-sphere-minutes.pdf");
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
            
            {sourceType === 'SYSTEM_AUDIO' && (
              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-100">
                <p className="font-semibold mb-2 flex items-center gap-2">
                  <Info size={14} className="text-blue-400" /> 
                  How to Enable Audio:
                </p>
                <ul className="list-disc list-inside space-y-2 text-blue-200/80 text-xs ml-1 leading-relaxed">
                  <li><strong>Browser Join:</strong> Select <em>"Chrome Tab"</em> and check <em>"Share tab audio"</em>.</li>
                  <li><strong>Desktop App (Windows):</strong> Select <em>"Entire Screen"</em> and check <em>"Share system audio"</em>.</li>
                  <li className="text-red-300 font-semibold">Do not select "Window". Audio is disabled in Window mode.</li>
                </ul>
              </div>
            )}
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

      {/* Guide Section */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl px-4">
        <div className="bg-slate-800/30 p-6 rounded-xl border border-slate-700/50 backdrop-blur-sm hover:bg-slate-800/50 transition-colors">
          <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4 text-blue-400">
            <Monitor size={20} />
          </div>
          <h3 className="text-slate-200 font-semibold mb-2">1. Select Source</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Use <strong>System Audio</strong> for online meetings. <br/>
            <em>Tip: Joining the meeting via your browser works best.</em>
          </p>
        </div>
        
        <div className="bg-slate-800/30 p-6 rounded-xl border border-slate-700/50 backdrop-blur-sm hover:bg-slate-800/50 transition-colors relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <AlertCircle size={64} />
          </div>
          <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center mb-4 text-purple-400">
             <AlertCircle size={20} />
          </div>
          <h3 className="text-slate-200 font-semibold mb-2">2. Avoid "Window" Tab</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            In the sharing popup: <br/>
            ✅ <strong>Chrome Tab</strong> (Has Audio)<br/>
            ✅ <strong>Entire Screen</strong> (Has Audio)<br/>
            ❌ <strong>Window</strong> (NO Audio)
          </p>
        </div>

        <div className="bg-slate-800/30 p-6 rounded-xl border border-slate-700/50 backdrop-blur-sm hover:bg-slate-800/50 transition-colors">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center mb-4 text-emerald-400">
            <CheckCircle2 size={20} />
          </div>
          <h3 className="text-slate-200 font-semibold mb-2">3. Auto-Minutes</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            DocSphere listens silently. When the meeting ends, click <strong>End Meeting</strong> to instantly generate professional minutes.
          </p>
        </div>
      </div>
    </div>
  );

  const renderRecording = () => (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between bg-slate-800/80 p-4 rounded-xl border border-slate-700 shadow-lg backdrop-blur-md sticky top-4 z-10">
        <div className="flex items-center gap-3">
            <div className="relative">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-ping absolute"></div>
                <div className="w-3 h-3 bg-red-500 rounded-full relative"></div>
            </div>
            <span className="font-mono text-red-200">Recording Live...</span>
        </div>
        <Button variant="danger" onClick={handleStopRecording}>
          <StopCircle size={20} /> End Meeting
        </Button>
      </div>

      <div className="flex-1 bg-slate-900/50 rounded-2xl border border-slate-800 p-6 overflow-hidden flex flex-col relative min-h-[400px]">
        <h3 className="text-slate-500 font-medium mb-4 uppercase tracking-wider text-xs flex justify-between">
            <span>Live Transcript</span>
            <span className="text-slate-600 lowercase font-normal italic">updates in real-time</span>
        </h3>
        <div className="flex-1 overflow-y-auto space-y-2 scrollbar-hide">
          {transcript ? (
             <p className="text-slate-200 text-lg leading-relaxed whitespace-pre-wrap">{transcript}</p>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4">
               <Loader2 size={32} className="animate-spin" />
               <p>Listening for speech...</p>
               {sourceType === 'SYSTEM_AUDIO' && (
                 <div className="text-xs text-slate-500 max-w-sm text-center bg-slate-800 p-3 rounded-lg border border-slate-700">
                    <p className="font-semibold text-slate-400 mb-1">Silence detected?</p>
                    <p>If people are talking but nothing appears, you likely shared the <strong>Window</strong> instead of the <strong>Entire Screen</strong> or <strong>Tab</strong>.</p>
                 </div>
               )}
            </div>
          )}
          {/* Auto-scroll anchor */}
          <div className="h-4" /> 
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
        <p className="text-slate-400">Consulting Gemini to format your meeting notes...</p>
      </div>
    </div>
  );

  const renderReviewing = () => (
    <div className="flex flex-col space-y-6 h-full">
       <div className="flex items-center justify-between bg-slate-800/80 p-4 rounded-xl border border-slate-700 sticky top-4 z-10 backdrop-blur-md">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="text-emerald-400" />
            Meeting Minutes
        </h2>
        <div className="flex gap-2">
            <Button variant="ghost" onClick={handleReset}>New Meeting</Button>
            <Button onClick={handleDownloadPDF}>
                <Download size={20} /> Export PDF
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
        {/* Editor Side */}
        <div className="bg-white text-slate-900 rounded-xl shadow-2xl overflow-hidden min-h-[600px] flex flex-col">
            <div className="p-8 space-y-6 flex-1 overflow-y-auto">
                {minutes && (
                    <>
                        <div className="border-b pb-4">
                            <input 
                                className="text-3xl font-bold w-full outline-none placeholder-slate-300" 
                                value={minutes.title}
                                onChange={(e) => setMinutes({...minutes, title: e.target.value})}
                                placeholder="Meeting Title"
                            />
                            <p className="text-slate-500 mt-2">
                                Date: <input 
                                    className="outline-none border-b border-transparent hover:border-slate-300 focus:border-blue-500"
                                    value={minutes.date}
                                    onChange={(e) => setMinutes({...minutes, date: e.target.value})}
                                />
                            </p>
                        </div>

                        <section>
                            <h3 className="text-lg font-bold text-slate-800 mb-2 uppercase tracking-wide text-xs">Attendees</h3>
                            <textarea 
                                className="w-full text-slate-600 outline-none resize-none overflow-hidden bg-slate-50 p-2 rounded"
                                rows={minutes.attendees.length || 1}
                                value={minutes.attendees.join(', ')}
                                onChange={(e) => setMinutes({...minutes, attendees: e.target.value.split(', ')})}
                            />
                        </section>

                         <section>
                            <h3 className="text-lg font-bold text-slate-800 mb-2 uppercase tracking-wide text-xs">Agenda</h3>
                             <textarea 
                                className="w-full text-slate-600 outline-none resize-y bg-slate-50 p-2 rounded min-h-[80px]"
                                value={minutes.agenda.map(a => `• ${a}`).join('\n')}
                                onChange={(e) => setMinutes({...minutes, agenda: e.target.value.split('\n').map(l => l.replace(/^• /, ''))})}
                            />
                        </section>

                        <section>
                            <h3 className="text-lg font-bold text-slate-800 mb-2 uppercase tracking-wide text-xs">Decisions Made</h3>
                             <textarea 
                                className="w-full text-slate-600 outline-none resize-y bg-slate-50 p-2 rounded min-h-[80px]"
                                value={minutes.decisions.map(d => `• ${d}`).join('\n')}
                                onChange={(e) => setMinutes({...minutes, decisions: e.target.value.split('\n').map(l => l.replace(/^• /, ''))})}
                            />
                        </section>

                        <section>
                            <h3 className="text-lg font-bold text-slate-800 mb-2 uppercase tracking-wide text-xs">Action Items</h3>
                            <div className="space-y-2">
                                {minutes.actionItems.map((item, idx) => (
                                    <div key={idx} className="flex gap-2 p-2 bg-yellow-50 rounded border border-yellow-100">
                                        <input type="checkbox" className="mt-1" />
                                        <div className="flex-1">
                                            <input 
                                                className="w-full bg-transparent font-medium outline-none text-slate-800"
                                                value={item.task} 
                                                onChange={(e) => {
                                                    const newItems = [...minutes.actionItems];
                                                    newItems[idx].task = e.target.value;
                                                    setMinutes({...minutes, actionItems: newItems});
                                                }}
                                            />
                                            <div className="flex gap-2 text-sm text-slate-500 mt-1">
                                                <span>Assignee:</span>
                                                 <input 
                                                    className="bg-transparent outline-none text-slate-700 w-32"
                                                    value={item.assignee} 
                                                    onChange={(e) => {
                                                        const newItems = [...minutes.actionItems];
                                                        newItems[idx].assignee = e.target.value;
                                                        setMinutes({...minutes, actionItems: newItems});
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>

        {/* Transcript Reference Side */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 h-[600px] overflow-y-auto">
             <h3 className="text-slate-400 font-medium mb-4 uppercase tracking-wider text-xs sticky top-0 bg-slate-800 py-2">Original Transcript</h3>
             <p className="text-slate-300 whitespace-pre-wrap leading-relaxed opacity-80 font-mono text-sm">{transcript}</p>
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
            {/* Install Button (Only visible if installable) */}
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
               v1.2 (Ready) • Gemini 2.5
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