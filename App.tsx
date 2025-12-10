import React, { useState, useRef, useEffect } from 'react';
import { Mic, Settings, FileText, Download, StopCircle, PlayCircle, Loader2, Monitor, AlertCircle, CheckCircle2, Info, XCircle, Smartphone, Wifi, WifiOff } from 'lucide-react';
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
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Update visual transcript state less frequently if needed, 
  // but for now we sync directly.
  useEffect(() => {
    transcriptRef.current = transcript;
    // Auto-scroll to bottom
    if (transcriptContainerRef.current) {
        transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
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
    if (!process.env.API_KEY) {
        setError("Missing API Key. Please configure your .env file with a valid Google GenAI API Key.");
        return;
    }

    try {
      let stream: MediaStream;
      
      if (sourceType === 'SYSTEM_AUDIO') {
        // System audio capture (requires Tab/Window sharing with audio checked)
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true, // Required for system audio in most browsers
            audio: {
              echoCancellation: false, // Important for high fidelity system audio
              noiseSuppression: false,
              autoGainControl: false,
            } 
          });
        } catch (e) {
          // User cancelled or permission denied
          return; 
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
      setTranscript(""); // Clear previous transcript
      
      liveClientRef.current = new LiveTranscriptionClient(
        (newText) => {
          setTranscript((prev) => prev + " " + newText);
        },
        (err) => {
          console.error(err);
          setError(err.message);
          // Don't stop immediately on minor errors, but if connection fails, we might need to.
          if (err.message.includes("Connection")) {
              handleStopRecording();
          }
        }
      );

      await liveClientRef.current.connectAndStart(stream);
      
      // Handle user stopping the stream via browser UI (e.g. "Stop Sharing" floating bar)
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
    
    // Check if we actually recorded anything meaningful
    if (status === MeetingStatus.RECORDING) {
        setStatus(MeetingStatus.PROCESSING);
        
        if (transcriptRef.current.trim().length < 10) {
            setError("Transcript too short to generate minutes. Please ensure audio was being shared.");
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
    } else {
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
    const pageWidth = 210;
    const maxLineWidth = pageWidth - (margin * 2);

    // Helper for adding text
    const addText = (text: string, fontSize: number = 12, fontStyle: string = 'normal', color: [number, number, number] = [0, 0, 0]) => {
      doc.setFont("helvetica", fontStyle);
      doc.setFontSize(fontSize);
      doc.setTextColor(color[0], color[1], color[2]);
      
      const splitText = doc.splitTextToSize(text, maxLineWidth);
      
      if (y + (splitText.length * (fontSize * 0.5)) > 280) {
        doc.addPage();
        y = margin;
      }
      
      doc.text(splitText, margin, y);
      y += (splitText.length * (fontSize * 0.5)) + 4;
    };

    // Header
    doc.setFillColor(15, 23, 42); // Slate 900
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text(minutes.title || "Meeting Minutes", margin, 20);
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${minutes.date}`, margin, 30);
    
    y = 55;

    if (minutes.attendees?.length > 0) {
      addText("Attendees", 14, "bold", [37, 99, 235]); // Blue
      y += 2;
      minutes.attendees.forEach(att => addText(`• ${att}`, 11));
      y += 6;
    }

    if (minutes.agenda?.length > 0) {
      addText("Agenda", 14, "bold", [37, 99, 235]);
      y += 2;
      minutes.agenda.forEach(item => addText(`• ${item}`, 11));
      y += 6;
    }

    if (minutes.discussionPoints?.length > 0) {
      addText("Key Discussion Points", 14, "bold", [37, 99, 235]);
      y += 2;
      minutes.discussionPoints.forEach(pt => addText(`• ${pt}`, 11));
      y += 6;
    }

    if (minutes.decisions?.length > 0) {
      addText("Decisions Made", 14, "bold", [16, 185, 129]); // Green
      y += 2;
      minutes.decisions.forEach(d => addText(`• ${d}`, 11));
      y += 6;
    }

    if (minutes.actionItems?.length > 0) {
      addText("Action Items", 14, "bold", [239, 68, 68]); // Red
      y += 2;
      minutes.actionItems.forEach(item => {
        addText(`[ ] ${item.task}`, 11, 'bold');
        addText(`    Assignee: ${item.assignee} | Due: ${item.deadline || 'N/A'}`, 10, 'italic', [100, 116, 139]);
        y += 2;
      });
    }

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Generated by DocSphere Scribe - Page ${i} of ${pageCount}`, margin, 290);
    }

    doc.save(`Meeting_Minutes_${minutes.date}.pdf`);
  };

  // --- Render Functions ---

  const renderIdle = () => (
    <div className="flex flex-col items-center justify-center space-y-8 animate-fade-in py-8">
      <div className="text-center space-y-4 max-w-2xl">
        <div className="inline-block p-2 rounded-2xl bg-slate-800/50 border border-slate-700 mb-2">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400 font-bold px-4 py-1">
                AI Powered Meeting Assistant
            </span>
        </div>
        <h1 className="text-5xl md:text-6xl font-bold text-white tracking-tight">
          DocSphere Scribe
        </h1>
        <p className="text-slate-400 text-lg md:text-xl font-light">
          Capture system audio from Zoom, Meet, or Teams. <br/>
          Get real-time transcription and instant minutes.
        </p>
      </div>

      <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 backdrop-blur-sm w-full max-w-md shadow-2xl hover:shadow-blue-900/10 transition-shadow duration-500">
        <h3 className="text-slate-200 font-semibold mb-6 flex items-center gap-2 border-b border-slate-700 pb-4">
          <Settings size={20} className="text-blue-400" /> Session Setup
        </h3>
        
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-3">Select Audio Source</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSourceType('SYSTEM_AUDIO')}
                className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all duration-200 group ${
                  sourceType === 'SYSTEM_AUDIO' 
                    ? 'bg-blue-600/20 border-blue-500 text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.2)]' 
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:bg-slate-700/80'
                }`}
              >
                <Monitor size={24} className={`group-hover:scale-110 transition-transform ${sourceType === 'SYSTEM_AUDIO' ? 'text-blue-400' : ''}`} />
                <span className="text-sm font-medium">System Audio</span>
              </button>
              <button
                onClick={() => setSourceType('MICROPHONE')}
                className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all duration-200 group ${
                  sourceType === 'MICROPHONE' 
                    ? 'bg-blue-600/20 border-blue-500 text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.2)]' 
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:bg-slate-700/80'
                }`}
              >
                <Mic size={24} className={`group-hover:scale-110 transition-transform ${sourceType === 'MICROPHONE' ? 'text-blue-400' : ''}`} />
                <span className="text-sm font-medium">Microphone</span>
              </button>
            </div>
            
            {sourceType === 'SYSTEM_AUDIO' && (
              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-100 animate-in fade-in slide-in-from-top-1">
                <p className="font-semibold mb-2 flex items-center gap-2 text-blue-300">
                  <Info size={14} /> 
                  Instructions for Best Results:
                </p>
                <ul className="list-disc list-inside space-y-1 text-blue-200/80 text-xs ml-1 leading-relaxed">
                  <li><strong>Browser:</strong> Select <em>"Chrome Tab"</em> & check <em>"Share tab audio"</em>.</li>
                  <li><strong>App (Zoom/Teams):</strong> Select <em>"Entire Screen"</em> & check <em>"Share system audio"</em>.</li>
                  <li className="text-red-300/90 font-medium mt-1">⚠️ Do NOT select "Window" (No Audio).</li>
                </ul>
              </div>
            )}
          </div>

          <Button 
            onClick={handleStartRecording} 
            className="w-full h-14 text-lg font-semibold shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <PlayCircle size={24} /> 
            {sourceType === 'SYSTEM_AUDIO' ? 'Select Screen & Start' : 'Start Recording'}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderRecording = () => (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between bg-slate-800/90 p-4 rounded-xl border border-slate-700 shadow-xl backdrop-blur-md sticky top-4 z-20">
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </div>
                <span className="font-mono text-red-200 text-sm font-bold uppercase tracking-wider">Live</span>
            </div>
            <div className="h-6 w-px bg-slate-700"></div>
            <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Wifi size={16} className="text-emerald-400" />
                <span>Connected to Gemini 2.5</span>
            </div>
        </div>
        <Button variant="danger" onClick={handleStopRecording} className="shadow-red-900/20">
          <StopCircle size={20} /> End Meeting & Generate Minutes
        </Button>
      </div>

      <div className="flex-1 bg-slate-900/50 rounded-2xl border border-slate-800 p-0 overflow-hidden flex flex-col relative min-h-[400px] shadow-inner">
        <div className="p-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur flex justify-between items-center">
            <h3 className="text-slate-400 font-medium uppercase tracking-wider text-xs flex gap-2 items-center">
                <FileText size={14} />
                Live Transcript
            </h3>
            <span className="text-slate-600 text-xs italic">Auto-scrolling enabled</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth" ref={transcriptContainerRef}>
          {transcript ? (
             <p className="text-slate-200 text-lg leading-loose whitespace-pre-wrap font-light tracking-wide">{transcript}</p>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-6 opacity-60">
               <div className="relative">
                   <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-20 rounded-full animate-pulse"></div>
                   <Loader2 size={48} className="animate-spin relative z-10 text-blue-500" />
               </div>
               <div className="text-center max-w-sm">
                   <p className="text-lg font-medium text-slate-400 mb-2">Listening for speech...</p>
                   {sourceType === 'SYSTEM_AUDIO' && (
                     <p className="text-sm text-slate-500">
                        If no text appears while people are talking, please verify you shared <strong>Tab Audio</strong> or <strong>System Audio</strong>.
                     </p>
                   )}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderProcessing = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] space-y-8 animate-in fade-in zoom-in duration-500">
      <div className="relative">
        <div className="absolute inset-0 bg-blue-500 blur-3xl opacity-20 rounded-full"></div>
        <div className="relative bg-slate-800 p-8 rounded-full border border-slate-700 shadow-2xl">
            <Loader2 size={64} className="text-blue-400 animate-spin" />
        </div>
      </div>
      <div className="text-center space-y-3 max-w-md">
        <h2 className="text-3xl font-bold text-white">Synthesizing Notes</h2>
        <p className="text-slate-400 text-lg">Gemini is analyzing the transcript to extract action items, decisions, and key points...</p>
        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden mt-6">
            <div className="h-full bg-blue-500 w-2/3 animate-[shimmer_2s_infinite]"></div>
        </div>
      </div>
    </div>
  );

  const renderReviewing = () => (
    <div className="flex flex-col space-y-6 h-full animate-in slide-in-from-bottom-4 duration-500">
       <div className="flex items-center justify-between bg-slate-800/90 p-4 rounded-xl border border-slate-700 sticky top-4 z-20 backdrop-blur-md shadow-xl">
        <h2 className="text-xl font-bold text-white flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                <CheckCircle2 size={20} />
            </div>
            Meeting Minutes Ready
        </h2>
        <div className="flex gap-3">
            <Button variant="secondary" onClick={handleReset}>New Meeting</Button>
            <Button onClick={handleDownloadPDF} className="bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20">
                <Download size={20} /> Export PDF
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
        {/* Editor Side */}
        <div className="bg-white text-slate-900 rounded-xl shadow-2xl overflow-hidden min-h-[600px] flex flex-col border border-slate-200">
            <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center">
                 <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Preview & Edit</span>
                 <div className="flex gap-2">
                     <div className="w-3 h-3 rounded-full bg-red-400"></div>
                     <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                     <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                 </div>
            </div>
            <div className="p-8 space-y-8 flex-1 overflow-y-auto">
                {minutes && (
                    <>
                        <div className="border-b border-slate-100 pb-6">
                            <input 
                                className="text-3xl font-bold w-full outline-none placeholder-slate-300 text-slate-900 bg-transparent" 
                                value={minutes.title}
                                onChange={(e) => setMinutes({...minutes, title: e.target.value})}
                                placeholder="Meeting Title"
                            />
                            <div className="flex items-center gap-2 mt-3 text-slate-500">
                                <span className="text-sm font-medium">Date:</span>
                                <input 
                                    className="outline-none border-b border-transparent hover:border-slate-300 focus:border-blue-500 bg-transparent text-sm"
                                    value={minutes.date}
                                    onChange={(e) => setMinutes({...minutes, date: e.target.value})}
                                />
                            </div>
                        </div>

                        <section className="bg-slate-50 p-6 rounded-xl border border-slate-100">
                            <h3 className="text-sm font-bold text-blue-600 mb-3 uppercase tracking-wide flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span> Attendees
                            </h3>
                            <textarea 
                                className="w-full text-slate-700 outline-none resize-none overflow-hidden bg-transparent leading-relaxed"
                                rows={Math.max(2, minutes.attendees.length)}
                                value={minutes.attendees.join(', ')}
                                onChange={(e) => setMinutes({...minutes, attendees: e.target.value.split(', ')})}
                            />
                        </section>

                         <section>
                            <h3 className="text-sm font-bold text-slate-800 mb-3 uppercase tracking-wide border-b border-slate-100 pb-2">Agenda</h3>
                             <textarea 
                                className="w-full text-slate-600 outline-none resize-y bg-transparent p-2 rounded hover:bg-slate-50 transition-colors leading-relaxed"
                                value={minutes.agenda.map(a => `• ${a}`).join('\n')}
                                onChange={(e) => setMinutes({...minutes, agenda: e.target.value.split('\n').map(l => l.replace(/^• /, ''))})}
                                rows={Math.max(3, minutes.agenda.length)}
                            />
                        </section>

                        <section>
                            <h3 className="text-sm font-bold text-slate-800 mb-3 uppercase tracking-wide border-b border-slate-100 pb-2">Decisions Made</h3>
                             <textarea 
                                className="w-full text-slate-600 outline-none resize-y bg-transparent p-2 rounded hover:bg-slate-50 transition-colors leading-relaxed"
                                value={minutes.decisions.map(d => `• ${d}`).join('\n')}
                                onChange={(e) => setMinutes({...minutes, decisions: e.target.value.split('\n').map(l => l.replace(/^• /, ''))})}
                                rows={Math.max(3, minutes.decisions.length)}
                            />
                        </section>

                        <section>
                            <h3 className="text-sm font-bold text-red-500 mb-3 uppercase tracking-wide border-b border-red-100 pb-2">Action Items</h3>
                            <div className="space-y-3">
                                {minutes.actionItems.map((item, idx) => (
                                    <div key={idx} className="flex gap-3 p-4 bg-red-50/50 rounded-xl border border-red-100/50 hover:border-red-200 transition-colors group">
                                        <input type="checkbox" className="mt-1.5 accent-red-500 cursor-pointer" />
                                        <div className="flex-1 space-y-1">
                                            <input 
                                                className="w-full bg-transparent font-medium outline-none text-slate-800 placeholder-red-300"
                                                value={item.task} 
                                                onChange={(e) => {
                                                    const newItems = [...minutes.actionItems];
                                                    newItems[idx].task = e.target.value;
                                                    setMinutes({...minutes, actionItems: newItems});
                                                }}
                                                placeholder="Task description"
                                            />
                                            <div className="flex gap-4 text-xs text-slate-500">
                                                <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-red-100">
                                                    <span className="opacity-50">Assignee:</span>
                                                     <input 
                                                        className="bg-transparent outline-none text-slate-700 w-24"
                                                        value={item.assignee} 
                                                        onChange={(e) => {
                                                            const newItems = [...minutes.actionItems];
                                                            newItems[idx].assignee = e.target.value;
                                                            setMinutes({...minutes, actionItems: newItems});
                                                        }}
                                                    />
                                                </div>
                                                <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-red-100">
                                                    <span className="opacity-50">Due:</span>
                                                     <input 
                                                        className="bg-transparent outline-none text-slate-700 w-24"
                                                        value={item.deadline || ''} 
                                                        onChange={(e) => {
                                                            const newItems = [...minutes.actionItems];
                                                            newItems[idx].deadline = e.target.value;
                                                            setMinutes({...minutes, actionItems: newItems});
                                                        }}
                                                        placeholder="No Date"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => {
                                                const newItems = minutes.actionItems.filter((_, i) => i !== idx);
                                                setMinutes({...minutes, actionItems: newItems});
                                            }}
                                            className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 transition-opacity"
                                        >
                                            <XCircle size={18} />
                                        </button>
                                    </div>
                                ))}
                                <Button 
                                    variant="ghost" 
                                    className="text-red-500 hover:bg-red-50 text-sm w-full border border-dashed border-red-200"
                                    onClick={() => {
                                        setMinutes({
                                            ...minutes, 
                                            actionItems: [...minutes.actionItems, { task: "New Task", assignee: "Unassigned" }]
                                        })
                                    }}
                                >
                                    + Add Action Item
                                </Button>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>

        {/* Transcript Reference Side */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 h-[600px] overflow-hidden flex flex-col shadow-xl">
             <div className="p-4 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                 <h3 className="text-slate-400 font-medium uppercase tracking-wider text-xs">Original Transcript Reference</h3>
             </div>
             <div className="p-6 overflow-y-auto flex-1 bg-slate-800">
                <p className="text-slate-300 whitespace-pre-wrap leading-loose font-light opacity-90 text-sm">{transcript}</p>
             </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 font-sans selection:bg-blue-500/30 overflow-x-hidden">
      <div className="max-w-7xl mx-auto px-4 py-6 min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between mb-8 animate-fade-in-down">
          <div className="flex items-center gap-3 group cursor-pointer" onClick={handleReset}>
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20 group-hover:shadow-blue-900/40 transition-shadow">
              <span className="font-bold text-white text-xl">D</span>
            </div>
            <div>
                <h1 className="font-bold text-xl tracking-tight leading-none">DocSphere</h1>
                <span className="text-xs text-blue-400 font-medium tracking-wider uppercase">Scribe</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Install Button (Only visible if installable) */}
            {isInstallable && (
              <button 
                onClick={handleInstallClick}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-sm"
              >
                <Smartphone size={16} className="text-blue-400" />
                Install App
              </button>
            )}

            <div className="hidden md:flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700/50">
               <div className={`w-2 h-2 rounded-full ${process.env.API_KEY ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
               <span className="text-xs text-slate-500 font-mono">
                   {process.env.API_KEY ? 'System Ready' : 'API Key Missing'}
               </span>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative">
          {error && (
            <div className="absolute top-0 left-0 right-0 z-50 bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-xl flex items-center justify-between mb-6 backdrop-blur-md shadow-lg animate-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="mt-0.5 shrink-0" />
                <div className="whitespace-pre-wrap font-medium text-sm">{error}</div>
              </div>
              <button onClick={() => setError(null)} className="text-red-300 hover:text-white p-2 hover:bg-red-500/20 rounded-lg transition-colors">
                  <XCircle size={20} />
              </button>
            </div>
          )}

          {status === MeetingStatus.IDLE && renderIdle()}
          {status === MeetingStatus.RECORDING && renderRecording()}
          {status === MeetingStatus.PROCESSING && renderProcessing()}
          {status === MeetingStatus.REVIEWING && renderReviewing()}
        </main>
        
        <footer className="mt-12 text-center text-slate-600 text-sm py-6 border-t border-slate-800/50">
            <p>DocSphere Scribe • Powered by Google Gemini 2.5 • Secure & Private</p>
        </footer>
      </div>
    </div>
  );
}

export default App;