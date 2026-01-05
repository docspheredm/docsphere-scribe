import { GoogleGenerativeAI } from "@google/generative-ai";
import { createBlob } from "../utils/audioUtils";
import { MeetingMinutes } from "../types";

const API_KEY = process.env.API_KEY || '';

// --- Live API Client for Transcription ---

export class LiveTranscriptionClient {
  private ai: GoogleGenerativeAI;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private isRecording: boolean = false;

  private onTranscriptionCallback: (text: string) => void;
  private onVolumeCallback: (level: number) => void;
  private onErrorCallback: (error: Error) => void;

  // Store audio chunks for batch transcription
  private audioChunks: Float32Array[] = [];
  private transcriptionInterval: number | null = null;

  constructor(
    onTranscription: (text: string) => void, 
    onVolume: (level: number) => void,
    onError: (error: Error) => void
  ) {
    this.ai = new GoogleGenerativeAI(API_KEY);
    this.onTranscriptionCallback = onTranscription;
    this.onVolumeCallback = onVolume;
    this.onErrorCallback = onError;
  }

  async connectAndStart(stream: MediaStream) {
    try {
      this.mediaStream = stream;
      this.isRecording = true;
      
      // Initialize Audio Context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      this.startAudioStreaming();
      
      // Send audio for transcription every 5 seconds
      this.transcriptionInterval = window.setInterval(() => {
        this.transcribeAccumulatedAudio();
      }, 5000);
      
    } catch (err) {
      this.onErrorCallback(err instanceof Error ? err : new Error("Failed to connect"));
    }
  }

  private startAudioStreaming() {
    if (!this.audioContext || !this.mediaStream) return;

    this.inputSource = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Calculate Volume Level (RMS) for the UI
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      this.onVolumeCallback(rms);

      // Store audio chunks for batch transcription
      this.audioChunks.push(new Float32Array(inputData));
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  private async transcribeAccumulatedAudio() {
    if (this.audioChunks.length === 0) return;

    try {
      // Combine all chunks
      const totalLength = this.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.audioChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Convert to base64 for API
      const blob = createBlob(combined, 16000);
      const base64Audio = await this.blobToBase64(blob);

      // Use Gemini to transcribe
      const model = this.ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: "audio/wav",
            data: base64Audio.split(',')[1] // Remove data:audio/wav;base64, prefix
          }
        },
        "Transcribe this audio accurately. Only return the transcribed text, nothing else."
      ]);

      const text = result.response.text();
      if (text && text.trim()) {
        this.onTranscriptionCallback(text.trim());
      }

      // Clear processed chunks
      this.audioChunks = [];
      
    } catch (error) {
      console.error("Transcription error:", error);
      // Don't call error callback for individual transcription failures
      // Just log and continue
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async disconnect() {
    this.isRecording = false;
    
    if (this.transcriptionInterval) {
      clearInterval(this.transcriptionInterval);
      this.transcriptionInterval = null;
    }
    
    // Transcribe any remaining audio
    await this.transcribeAccumulatedAudio();
    
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
    
    this.audioChunks = [];
  }
}

// --- Static Generation for Minutes ---

export const generateMinutes = async (transcript: string): Promise<MeetingMinutes> => {
  const ai = new GoogleGenerativeAI(API_KEY);
  
  const prompt = `
You are an expert secretary. Based on the following meeting transcript, generate a formal Minutes of Meeting (MoM) document.

Transcript:
"${transcript}"

Use ISO 8601 format for date if mentioned, otherwise use today's date.
Infer attendees if mentioned by name.

Return the result in strict JSON format with this structure:
{
  "title": "string",
  "date": "string",
  "attendees": ["string"],
  "agenda": ["string"],
  "discussionPoints": ["string"],
  "decisions": ["string"],
  "actionItems": [{
    "task": "string",
    "assignee": "string",
    "deadline": "string"
  }]
}
`;

  const model = ai.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json"
    }
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  
  if (!text) throw new Error("No response from AI");
  
  return JSON.parse(text) as MeetingMinutes;
};
