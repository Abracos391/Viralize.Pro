export enum DurationOption {
  SHORT = '15s',
  LONG = '30s'
}

export enum TargetPlatform {
  TIKTOK = 'TikTok',
  REELS = 'Instagram Reels',
  SHORTS = 'YouTube Shorts'
}

export enum MarketingGoal {
  SALES = 'Direct Sales / Conversion',
  TRAFFIC = 'Traffic Generation',
  ENGAGEMENT = 'Viral Engagement',
  AWARENESS = 'Brand Awareness'
}

export interface SocialAccount {
  id: string;
  platform: TargetPlatform;
  username: string;
  avatarUrl: string;
  connected: boolean;
  status: 'active' | 'expired';
}

export interface ScheduledPost {
  id: string;
  scriptTitle: string;
  platform: TargetPlatform;
  date: string;
  time: string;
  status: 'scheduled' | 'posted';
}

export interface ComplianceResult {
  isSafe: boolean;
  flaggedCategories: string[];
  reason: string;
  suggestion: string;
}

export interface VideoInputData {
  productName: string;
  description: string;
  targetAudience: string;
  duration: DurationOption;
  platform: TargetPlatform;
  marketingGoal: MarketingGoal;
  customKeywords: string;
  url?: string;
}

export interface Scene {
  id: number;
  duration: number;
  narration: string;
  overlayText: string;
  imageKeyword: string;
  seoKeywordUsed?: string;
  isCta?: boolean;
}

export interface GeneratedScript {
  title: string;
  scenes: Scene[];
  seoKeywords: string[];
  hashtags: string[];
  estimatedViralScore: number;
  tone: string;
  complianceCheck?: ComplianceResult;
}

export type AppState = 'input' | 'generating' | 'preview' | 'accounts' | 'schedule' | 'analytics';
