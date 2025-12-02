export enum DurationOption {
  SHORT = '15s',
  LONG = '30s'
}

export enum TargetPlatform {
  TIKTOK = 'TikTok',
  REELS = 'Instagram Reels',
  SHORTS = 'YouTube Shorts'
}

export interface VideoInputData {
  productName: string;
  description: string;
  targetAudience: string;
  duration: DurationOption;
  platform: TargetPlatform;
  url?: string;
}

export interface Scene {
  id: number;
  duration: number; // in seconds
  narration: string;
  overlayText: string;
  imageKeyword: string; // Used to fetch a relevant placeholder
  seoKeywordUsed?: string;
  isCta?: boolean;
}

export interface GeneratedScript {
  title: string;
  scenes: Scene[];
  seoKeywords: string[];
  hashtags: string[];
  estimatedViralScore: number; // Simulated metric
  tone: string;
}

export type AppState = 'input' | 'generating' | 'preview';