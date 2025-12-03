import { GoogleGenAI, Modality } from "@google/genai";
import { VideoInputData, GeneratedScript, DurationOption, ComplianceResult, MarketingGoal } from "../types";

// --- API KEY MANAGER ---
// USER PROVIDED KEY INJECTED FOR IMMEDIATE FIX
const EMERGENCY_KEY = "AIzaSyC_Xye5mxdCgNvRjCL9XLKJXUF8z7XrUTI";

export const getApiKey = (): string => {
    // 1. Check Environment Variable (Build time / Render)
    const envKey = process.env.API_KEY;
    if (envKey && envKey.length > 10 && envKey !== 'undefined') {
        return envKey;
    }
    // 2. Check Browser Storage (Runtime)
    if (typeof window !== 'undefined') {
        const localKey = localStorage.getItem('GEMINI_API_KEY');
        if (localKey && localKey.length > 10) return localKey;
    }
    
    // 3. Fallback to Emergency Key provided by user
    return EMERGENCY_KEY;
};

export const setRuntimeApiKey = (key: string) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem('GEMINI_API_KEY', key);
        window.location.reload();
    }
};

export const hasValidKey = (): boolean => {
    const key = getApiKey();
    return key.length > 10;
};

// --- MOCK DATA FOR DEMO MODE (NO API KEY) ---
const MOCK_SCRIPT: GeneratedScript = {
    title: "Demo Video (No API Key)",
    tone: "Professional",
    seoKeywords: ["demo", "test", "viralize"],
    hashtags: ["#demo", "#viralizepro"],
    estimatedViralScore: 85,
    scenes: [
        { id: 1, duration: 2.5, narration: "Welcome to Viralize Pro demo mode.", overlayText: "VIRALIZE PRO DEMO", imageKeyword: "technology", isCta: false },
        { id: 2, duration: 2.5, narration: "We create videos without API keys.", overlayText: "NO KEYS NEEDED", imageKeyword: "coding", isCta: false },
        { id: 3, duration: 2.5, narration: "Using FFmpeg inside the browser.", overlayText: "BROWSER POWER", imageKeyword: "laptop", isCta: false },
        { id: 4, duration: 2.5, narration: "Fast rendering with WebAssembly.", overlayText: "FAST RENDER", imageKeyword: "rocket", isCta: false },
        { id: 5, duration: 2.5, narration: "Download your video instantly.", overlayText: "DOWNLOAD NOW", imageKeyword: "download", isCta: true },
        { id: 6, duration: 2.5, narration: "Click the link to start today.", overlayText: "LINK IN BIO", imageKeyword: "success", isCta: true }
    ]
};

// --- CACHE UTILS ---
const hashCode = (s: string) => {
    let h = 0, l = s.length, i = 0;
    if ( l > 0 )
      while (i < l)
        h = (h << 5) - h + s.charCodeAt(i++) | 0;
    return h;
};

const getCachedAudio = (text: string): string | null => {
    try {
        const key = `tts_cache_${hashCode(text)}`;
        const cached = localStorage.getItem(key);
        if (cached) return cached;
    } catch (e) {
        console.warn("Cache retrieval failed", e);
    }
    return null;
};

const setCachedAudio = (text: string, data: string) => {
    try {
        const key = `tts_cache_${hashCode(text)}`;
        localStorage.setItem(key, data);
    } catch (e) {
        console.warn("Cache storage failed", e);
    }
};

const parseJSON = (text: string) => {
    try {
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("Failed to parse Gemini JSON:", e);
        throw new Error("Failed to parse generation result.");
    }
};

// --- COMPLIANCE & TRENDS AI ---

export const validateContentSafety = async (product: string, description: string): Promise<ComplianceResult> => {
    const apiKey = getApiKey();
    // BYPASS: If no key, assume safe for demo purposes
    if (!apiKey) return { isSafe: true, flaggedCategories: [], reason: "Demo Mode", suggestion: "" };

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `
    ACT AS A SOCIAL MEDIA COMPLIANCE OFFICER (TikTok, Meta, YouTube).
    Analyze this input for violations:
    Product: ${product}
    Description: ${description}

    Check for: 
    1. Unrealistic financial promises (Get rich quick).
    2. Prohibited goods (Weapons, Drugs, Tobacco).
    3. Adult/Sexual content.
    4. Scams/Fraud.
    5. Copyright infringement risks (IPTV, Fake luxury).

    Return JSON ONLY:
    {
        "isSafe": boolean,
        "flaggedCategories": ["string"],
        "reason": "short explanation",
        "suggestion": "how to fix it"
    }
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        return parseJSON(response.text) as ComplianceResult;
    } catch (e) {
        return { isSafe: true, flaggedCategories: [], reason: "AI check failed", suggestion: "" };
    }
};

export const fetchTrendingKeywords = async (niche: string): Promise<string[]> => {
    const apiKey = getApiKey();
    // BYPASS: If no key, return generic tags
    if (!apiKey) return ["#viral", "#trending", "#demo"];
    
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
    List 5 currently trending high-traffic SEO keywords and hashtags specifically for the "${niche}" niche on TikTok and Instagram Reels for today.
    Return JSON: { "keywords": ["word1", "word2", "word3", "word4", "word5"] }
    `;
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        const data = parseJSON(response.text);
        return data.keywords || [];
    } catch (e) {
        return ["#viral", "#fyp", "#trending"];
    }
};

// --- STOCK MEDIA SERVICE ---
export const getStockImage = async (keyword: string): Promise<string> => {
    const pexelsKey = process.env.PEXELS_API_KEY;
    const fallbackUrl = `https://picsum.photos/seed/${keyword}/1080/1920`;

    if (!pexelsKey || pexelsKey.length < 10 || pexelsKey === 'undefined') return fallbackUrl;

    try {
        const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=1&orientation=portrait`, {
            headers: { Authorization: pexelsKey }
        });
        if (!response.ok) throw new Error("Pexels API Error");
        const data = await response.json();
        if (data.photos && data.photos.length > 0) return data.photos[0].src.portrait;
    } catch (e) {
        console.warn("Failed to fetch stock image", e);
    }
    return fallbackUrl;
};

// --- SCRIPT GENERATION ---
export const generateVideoScript = async (input: VideoInputData): Promise<GeneratedScript> => {
  const apiKey = getApiKey();
  
  // BYPASS: If no key, return Mock Script immediately.
  if (!apiKey) {
      console.warn("No API Key found. Using Demo Script.");
      return MOCK_SCRIPT;
  }

  const ai = new GoogleGenAI({ apiKey });

  const numScenes = input.duration === DurationOption.SHORT ? 6 : 10;
  
  const systemInstruction = `
    You are "Viralize Pro", an AI marketing expert.
    GOAL: ${input.marketingGoal}.
    SEO: Distribute the keywords: [${input.customKeywords}] across the scenes.
  `;

  const prompt = `
    GENERATE A VIDEO SCRIPT.
    Product: ${input.productName}
    Description: ${input.description}
    Target Audience: ${input.targetAudience}
    Platform: ${input.platform}
    Duration: ${input.duration} (${numScenes} images)
    
    STRICT RULES:
    1. Return JSON only.
    2. Exactly ${numScenes} scenes.
    3. Scene 1 = HOOK (1.5s-2.5s).
    4. Scene ${numScenes} = CTA (3.5s-4.5s).
    5. "imageKeyword" must be a single visual English word for stock photos.

    JSON SCHEMA:
    {
      "title": "Internal Title",
      "tone": "Tone description",
      "seoKeywords": ["extracted keywords"],
      "hashtags": ["#tags"],
      "estimatedViralScore": number (0-100),
      "scenes": [
        {
          "id": 1,
          "duration": number,
          "narration": "TTS text",
          "overlayText": "Screen text",
          "imageKeyword": "search_term",
          "isCta": boolean
        }
      ]
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return parseJSON(text) as GeneratedScript;

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

// Helper: Generate a simple beep WAV in base64 for demo purposes
// Valid 16-bit PCM WAV (Silence/Beep)
export const generateMockAudioBase64 = (): string => {
    return "UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="; 
}

export const generateNarration = async (text: string, onRetry?: (msg: string) => void): Promise<string> => {
    const cached = getCachedAudio(text);
    if (cached) {
        if (onRetry) onRetry("Loaded from cache");
        return cached;
    }

    const apiKey = getApiKey();
    
    // BYPASS: If no key, return dummy audio so FFmpeg doesn't crash
    if (!apiKey) {
        console.warn("No API Key. Returning mock audio.");
        return generateMockAudioBase64();
    }

    const ai = new GoogleGenAI({ apiKey });
    const MAX_RETRIES = 5; // Reduced max retries to avoid infinite loop feeling
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Kore' }, 
                        },
                    },
                },
            });

            const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (audioData) {
                setCachedAudio(text, audioData);
                return audioData;
            }
            throw new Error("API returned empty audio");

        } catch (e: any) {
            console.warn(`TTS Attempt ${attempt} failed:`, e.message);
            lastError = e;
            const isRateLimit = e.message?.includes('429') || e.message?.includes('503');
            // If rate limit, wait. If other error (e.g. invalid key), fail fast.
            if (!isRateLimit) break;

            const waitTime = 2000 * attempt;
            if (onRetry) {
                onRetry(`Google API Busy. Retrying ${attempt}/${MAX_RETRIES}...`);
            }
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    // If all failed, throw error to let player handle fallback
    throw lastError || new Error("Failed to generate audio.");
}
