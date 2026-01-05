import { GoogleGenerativeAI } from "@google/generative-ai";
import { createBlob } from "../utils/audioUtils";
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
  private onVolumeCallback: (level: number) => void;
  private onErrorCallback: (error: Error) => void;

  constructor(
    onTranscription: (text: string) => void, 
    onVolume: (level: number) => void,
    onError: (error: Error) => void
  ) {
    this.ai = new GoogleGenerativeAI({ apiKey: API_KEY });
    this.onTranscriptionCallback = onTranscription;
    this.onVolumeCallback = onVolume;
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
          systemInstruction: "You are a passive meeting scribe. Your ONLY job is to listen and transcribe accurately. Do not speak. Do not reply. Just listen.",
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Connected");
            this.startAudioStreaming();
          },
          onmessage: (message: LiveServerMessage) => {
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
      
      // Calculate Volume Level (RMS) for the UI
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      this.onVolumeCallback(rms);

      // Send to Gemini
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
