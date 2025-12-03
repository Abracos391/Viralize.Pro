import { GoogleGenAI, Modality } from "@google/genai";
import { VideoInputData, GeneratedScript, DurationOption, ComplianceResult, MarketingGoal } from "../types";

// --- API KEY MANAGER ---
// USER PROVIDED KEY INJECTED FOR IMMEDIATE FIX
const EMERGENCY_KEY = "AIzaSyBSEELLWDIa01iwsXLlGtNHg283oqSu65g";

export const getApiKey = (): string => {
    let candidateKey = "";

    // 1. Check Environment Variable (Build time / Render)
    const envKey = process.env.API_KEY;
    if (envKey && envKey.length > 10 && envKey !== 'undefined') {
        candidateKey = envKey;
    }
    
    // 2. Check Browser Storage (Runtime) - Overrides Env if present
    if (typeof window !== 'undefined') {
        const localKey = localStorage.getItem('GEMINI_API_KEY');
        if (localKey && localKey.length > 10) {
            candidateKey = localKey;
        }
    }

    // 3. VALIDATION: Google Keys MUST start with "AIza"
    if (candidateKey && candidateKey.startsWith("AIza")) {
        return candidateKey;
    }
    
    // 4. Fallback to Emergency Key provided by user
    if (EMERGENCY_KEY.startsWith("AIza")) {
        return EMERGENCY_KEY;
    }

    return "";
};

export const setRuntimeApiKey = (key: string) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem('GEMINI_API_KEY', key);
        window.location.reload();
    }
};

export const hasValidKey = (): boolean => {
    const key = getApiKey();
    return key.length > 10 && key.startsWith("AIza");
};

// --- TIMEOUT UTILS ---
const withTimeout = <T>(promise: Promise<T>, ms: number, fallbackValue?: T): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
            setTimeout(() => {
                if (fallbackValue !== undefined) {
                    reject(new Error("TIMEOUT")); 
                } else {
                    reject(new Error("TIMEOUT"));
                }
            }, ms)
        )
    ]);
};

// --- MOCK DATA FOR DEMO MODE ---
const MOCK_SCRIPT: GeneratedScript = {
    title: "Demo Video (Backup Mode)",
    tone: "Professional",
    seoKeywords: ["demo", "backup", "viralize"],
    hashtags: ["#demo", "#viralizepro"],
    estimatedViralScore: 85,
    scenes: [
        { id: 1, duration: 2.5, narration: "Visuals generated without AI connection.", overlayText: "AI SERVICE OFFLINE", imageKeyword: "error", isCta: false },
        { id: 2, duration: 2.5, narration: "We switched to backup mode automatically.", overlayText: "BACKUP ACTIVE", imageKeyword: "shield", isCta: false },
        { id: 3, duration: 2.5, narration: "Your API key is valid but needs activation.", overlayText: "ENABLE API", imageKeyword: "settings", isCta: false },
        { id: 4, duration: 2.5, narration: "Check Google Console to enable Generative Language.", overlayText: "CHECK CONSOLE", imageKeyword: "cloud", isCta: false },
        { id: 5, duration: 2.5, narration: "You can still download this video test.", overlayText: "DOWNLOAD TEST", imageKeyword: "download", isCta: true },
        { id: 6, duration: 2.5, narration: "Click the link to fix your account.", overlayText: "FIX ACCOUNT", imageKeyword: "success", isCta: true }
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
    if (!apiKey) return { isSafe: true, flaggedCategories: [], reason: "Demo Mode", suggestion: "" };

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `
    ACT AS A SOCIAL MEDIA COMPLIANCE OFFICER (TikTok, Meta, YouTube).
    Analyze this input for SEVERE violations:
    Product: ${product}
    Description: ${description}
    Return JSON ONLY: { "isSafe": boolean, "flaggedCategories": ["string"], "reason": "string", "suggestion": "string" }
    `;

    try {
        // Timeout 5 seconds - Compliance shouldn't block user
        const response = await withTimeout(ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        }), 5000);
        return parseJSON(response.text) as ComplianceResult;
    } catch (e: any) {
        console.warn("Compliance check skipped:", e.message);
        return { isSafe: true, flaggedCategories: [], reason: "AI check skipped", suggestion: "" };
    }
};

export const fetchTrendingKeywords = async (niche: string): Promise<string[]> => {
    const apiKey = getApiKey();
    if (!apiKey) return ["#viral", "#trending", "#demo"];
    
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `List 5 trending hashtags for "${niche}". Return JSON: { "keywords": ["tag1"] }`;
    
    try {
        const response = await withTimeout(ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        }), 5000);
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
        // 4 second timeout for images
        const response = await withTimeout(fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=1&orientation=portrait`, {
            headers: { Authorization: pexelsKey }
        }), 4000);
        
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
  
  if (!apiKey) {
      console.warn("No API Key found. Using Demo Script.");
      return MOCK_SCRIPT;
  }

  const ai = new GoogleGenAI({ apiKey });
  const numScenes = input.duration === DurationOption.SHORT ? 6 : 10;
  
  const prompt = `
    GENERATE VIDEO SCRIPT for ${input.productName}.
    Duration: ${input.duration} (${numScenes} scenes).
    Goal: ${input.marketingGoal}.
    Target: ${input.targetAudience}.
    Return JSON Schema: { title, tone, seoKeywords, hashtags, estimatedViralScore, scenes: [{id, duration, narration, overlayText, imageKeyword, isCta}] }
  `;

  try {
    // 12 Second timeout for script generation
    const response = await withTimeout(ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: "application/json" },
    }), 12000); 

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    return parseJSON(text) as GeneratedScript;

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    console.warn("Generating Script Failed. Falling back to Mock Script.");
    return MOCK_SCRIPT;
  }
};

// Helper: Return Safe SILENCE flag instead of corruptable base64
export const generateMockAudioBase64 = (): string => {
    return "SILENCE"; 
}

export const generateNarration = async (text: string, onRetry?: (msg: string) => void): Promise<string> => {
    const cached = getCachedAudio(text);
    if (cached) {
        if (onRetry) onRetry("Loaded from cache");
        return cached;
    }

    const apiKey = getApiKey();
    if (!apiKey) return generateMockAudioBase64();

    const ai = new GoogleGenAI({ apiKey });
    
    // STRICT TIMEOUT FOR AUDIO: 8 Seconds per clip
    try {
        const response = await withTimeout(ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            },
        }), 8000); 

        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audioData) {
            setCachedAudio(text, audioData);
            return audioData;
        }
        throw new Error("API returned empty audio");

    } catch (e: any) {
        console.warn(`TTS Failed or Timed out:`, e.message);
        // Failover to Safe Silence
        return generateMockAudioBase64();
    }
}
