import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { createBlob, downsampleBuffer } from "../utils/audioUtils";
import { MeetingMinutes } from "../types";

const API_KEY = process.env.API_KEY || '';

// --- Live API Client for Transcription ---

export class LiveTranscriptionClient {
  private ai: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;

  private onTranscriptionCallback: (text: string) => void;
  private onErrorCallback: (error: Error) => void;

  constructor(onTranscription: (text: string) => void, onError: (error: Error) => void) {
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
    this.onTranscriptionCallback = onTranscription;
    this.onErrorCallback = onError;
  }

  async connectAndStart(stream: MediaStream) {
    try {
      this.mediaStream = stream;
      
      // Initialize Audio Context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000, // Desired sample rate for Gemini
      });

      // Connect to Gemini Live
      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO], // We must accept audio back, even if we don't play it
          inputAudioTranscription: {}, // Enable transcription of input
          systemInstruction: "You are a passive meeting scribe. Your ONLY job is to listen. Do not speak. Do not reply. Just listen.",
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Connected");
            this.startAudioStreaming();
          },
          onmessage: (message: LiveServerMessage) => {
            // We are primarily interested in inputTranscription (what the user/meeting said)
            // Note: In a real "bot" scenario, we might also get model turns, but we instructed it to be silent.
            
            if (message.serverContent?.inputTranscription) {
               const text = message.serverContent.inputTranscription.text;
               if (text) {
                 this.onTranscriptionCallback(text);
               }
            }
          },
          onclose: () => {
            console.log("Gemini Live Session Closed");
          },
          onerror: (e) => {
            console.error("Gemini Live Error", e);
            this.onErrorCallback(new Error("Connection error"));
          }
        }
      });
      
    } catch (err) {
      this.onErrorCallback(err instanceof Error ? err : new Error("Failed to connect"));
    }
  }

  private startAudioStreaming() {
    if (!this.audioContext || !this.mediaStream || !this.sessionPromise) return;

    this.inputSource = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      // Downsample is handled by AudioContext being initialized at 16000 if browser supports it,
      // otherwise we might need manual downsampling. 
      // Most modern browsers support context sampleRate.
      
      const pcmBlob = createBlob(inputData, 16000);
      
      this.sessionPromise?.then((session) => {
        session.sendRealtimeInput({ media: pcmBlob });
      });
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  async disconnect() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    // We can't explicitly "close" the session object returned by connect directly in the current SDK 
    // without storing the session object properly, but stopping the stream effectively ends interaction.
    // The socket usually closes on page unload or timeout.
  }
}

// --- Static Generation for Minutes ---

export const generateMinutes = async (transcript: string): Promise<MeetingMinutes> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const prompt = `
    You are an expert secretary. Based on the following meeting transcript, generate a formal Minutes of Meeting (MoM) document.
    
    Transcript:
    "${transcript}"
    
    Use ISO 8601 format for date if mentioned, otherwise use today's date.
    Infer attendees if mentioned by name.
    
    Return the result in strict JSON format matching this schema.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          date: { type: Type.STRING },
          attendees: { type: Type.ARRAY, items: { type: Type.STRING } },
          agenda: { type: Type.ARRAY, items: { type: Type.STRING } },
          discussionPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
          decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
          actionItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                task: { type: Type.STRING },
                assignee: { type: Type.STRING },
                deadline: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  
  return JSON.parse(text) as MeetingMinutes;
};