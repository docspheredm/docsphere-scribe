import { Blob } from '@google/genai';

export const float32ToPCM16 = (float32Array: Float32Array): Int16Array => {
  const l = float32Array.length;
  const int16Array = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
};

export const createBlob = (data: Float32Array, sampleRate: number): Blob => {
  const int16 = float32ToPCM16(data);
  return {
    data: base64EncodeInt16(int16),
    mimeType: `audio/pcm;rate=${sampleRate}`,
  };
};

export const base64EncodeInt16 = (int16Array: Int16Array): string => {
  let binary = '';
  const len = int16Array.byteLength;
  const bytes = new Uint8Array(int16Array.buffer);
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

// Resamples audio to target sample rate if necessary
export const downsampleBuffer = (
  buffer: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array => {
  if (outputSampleRate === inputSampleRate) {
    return buffer;
  }
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
};