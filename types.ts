export enum MeetingStatus {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PROCESSING = 'PROCESSING',
  REVIEWING = 'REVIEWING'
}

export interface TranscriptSegment {
  text: string;
  timestamp: string;
  isFinal: boolean;
}

export interface MeetingMinutes {
  title: string;
  date: string;
  attendees: string[];
  agenda: string[];
  discussionPoints: string[];
  decisions: string[];
  actionItems: Array<{
    task: string;
    assignee: string;
    deadline?: string;
  }>;
}

export type AudioSourceType = 'MICROPHONE' | 'SYSTEM_AUDIO';

// PWA Install Prompt Event Type
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}