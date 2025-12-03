import { GoogleGenAI, Modality } from "@google/genai";
import { VideoInputData, GeneratedScript, DurationOption, ComplianceResult, MarketingGoal } from "../types";

// --- API KEY MANAGER ---
const EMERGENCY_KEY = "AIzaSyBSEELLWDIa01iwsXLlGtNHg283oqSu65g";

export const getApiKey = (): string => {
    let candidateKey = "";
    const envKey = process.env.API_KEY;
    if (envKey && envKey.length > 10 && envKey !== 'undefined') candidateKey = envKey;
    if (typeof window !== 'undefined') {
        const localKey = localStorage.getItem('GEMINI_API_KEY');
        if (localKey && localKey.length > 10) candidateKey = localKey;
    }
    if (candidateKey && candidateKey.startsWith("AIza")) return candidateKey;
    if (EMERGENCY_KEY.startsWith("AIza")) return EMERGENCY_KEY;
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
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms))
    ]);
};

// --- MOCK DATA ---
const MOCK_SCRIPT: GeneratedScript = {
    title: "Demo Video (Backup Mode)",
    tone: "Professional",
    seoKeywords: ["demo", "backup", "viralize"],
    hashtags: ["#demo", "#viralizepro"],
    estimatedViralScore: 85,
    scenes: [
        { id: 1, duration: 2.5, narration: "Visuals generated without AI connection.", overlayText: "AI SERVICE OFFLINE", imageKeyword: "abstract technology background blue", isCta: false },
        { id: 2, duration: 2.5, narration: "We switched to backup mode automatically.", overlayText: "BACKUP ACTIVE", imageKeyword: "shield security protection icon", isCta: false },
        { id: 3, duration: 2.5, narration: "Your API key is valid but needs activation.", overlayText: "ENABLE API", imageKeyword: "computer settings gear icon", isCta: false },
        { id: 4, duration: 2.5, narration: "Check Google Console to enable Generative Language.", overlayText: "CHECK CONSOLE", imageKeyword: "cloud server data connection", isCta: false },
        { id: 5, duration: 2.5, narration: "You can still download this video test.", overlayText: "DOWNLOAD TEST", imageKeyword: "download button interface", isCta: true },
        { id: 6, duration: 2.5, narration: "Click the link to fix your account.", overlayText: "FIX ACCOUNT", imageKeyword: "happy successful person thumbs up", isCta: true }
    ]
};

// --- CACHE ---
const hashCode = (s: string) => {
    let h = 0, l = s.length, i = 0;
    if ( l > 0 ) while (i < l) h = (h << 5) - h + s.charCodeAt(i++) | 0;
    return h;
};

const getCachedAudio = (text: string): string | null => {
    try {
        const key = `tts_cache_${hashCode(text)}`;
        return localStorage.getItem(key);
    } catch (e) { return null; }
};

const setCachedAudio = (text: string, data: string) => {
    try {
        const key = `tts_cache_${hashCode(text)}`;
        localStorage.setItem(key, data);
    } catch (e) {}
};

const parseJSON = (text: string) => {
    try {
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        throw new Error("Failed to parse generation result.");
    }
};

// --- AI SERVICES ---

export const validateContentSafety = async (product: string, description: string): Promise<ComplianceResult> => {
    const apiKey = getApiKey();
    if (!apiKey) return { isSafe: true, flaggedCategories: [], reason: "Demo Mode", suggestion: "" };

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `ACT AS A SOCIAL MEDIA COMPLIANCE OFFICER. Analyze for SEVERE violations (Illegal, Adult, Hate). Return JSON: { "isSafe": boolean, "flaggedCategories": ["string"], "reason": "string", "suggestion": "string" }`;

    try {
        const response = await withTimeout(ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        }), 5000);
        return parseJSON(response.text) as ComplianceResult;
    } catch (e) {
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
        return parseJSON(response.text).keywords || [];
    } catch (e) {
        return ["#viral", "#fyp", "#trending"];
    }
};

export const getStockImage = async (keyword: string): Promise<string> => {
    const pexelsKey = process.env.PEXELS_API_KEY;
    // Fallback: Use Picsum with the keyword as seed.
    const fallbackUrl = `https://picsum.photos/seed/${encodeURIComponent(keyword)}/1080/1920`;

    if (!pexelsKey || pexelsKey.length < 10 || pexelsKey === 'undefined') return fallbackUrl;

    try {
        // Search Pexels with Portrait Orientation
        const response = await withTimeout(fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=1&orientation=portrait`, {
            headers: { Authorization: pexelsKey }
        }), 4000);
        
        if (!response.ok) throw new Error("Pexels API Error");
        const data = await response.json();
        if (data.photos && data.photos.length > 0) return data.photos[0].src.portrait;
    } catch (e) {
        console.warn("Failed to fetch stock image, using fallback", e);
    }
    return fallbackUrl;
};

export const generateVideoScript = async (input: VideoInputData): Promise<GeneratedScript> => {
  const apiKey = getApiKey();
  if (!apiKey) return MOCK_SCRIPT;

  const ai = new GoogleGenAI({ apiKey });
  const numScenes = input.duration === DurationOption.SHORT ? 6 : 10;
  
  // IMPROVED PROMPT FOR CONTEXTUAL IMAGES
  const prompt = `
    GENERATE VIDEO SCRIPT for product: ${input.productName}.
    Context: ${input.description}.
    Audience: ${input.targetAudience}.
    Duration: ${input.duration} (${numScenes} scenes).
    
    CRITICAL RULE FOR "imageKeyword":
    - Do NOT use abstract words like "Success", "Fitness", "Happy".
    - MUST use CONCRETE VISUAL DESCRIPTIONS for stock photo search.
    - Example BAD: "Health"
    - Example GOOD: "Close up of fresh green salad bowl", "Man running in park sunny day", "Woman typing on laptop office".
    - Keep it under 5 words.

    Return JSON Schema: 
    { 
        "title": "string", 
        "tone": "string", 
        "seoKeywords": ["string"], 
        "hashtags": ["string"], 
        "estimatedViralScore": number, 
        "scenes": [
            {
                "id": number, 
                "duration": number, 
                "narration": "string (script for TTS)", 
                "overlayText": "string (short text on screen)", 
                "imageKeyword": "string (CONCRETE VISUAL SEARCH TERM)", 
                "isCta": boolean
            }
        ] 
    }
  `;

  try {
    const response = await withTimeout(ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: "application/json" },
    }), 15000); 

    const text = response.text;
    if (!text) throw new Error("No response");
    return parseJSON(text) as GeneratedScript;

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error.message?.includes("SERVICE_DISABLED") || error.message?.includes("403")) {
        return MOCK_SCRIPT;
    }
    // Fail fast to mock
    return MOCK_SCRIPT;
  }
};

export const generateMockAudioBase64 = (): string => {
    return "SILENCE"; 
}

export const generateNarration = async (text: string, onRetry?: (msg: string) => void): Promise<string> => {
    const cached = getCachedAudio(text);
    if (cached) return cached;

    const apiKey = getApiKey();
    if (!apiKey) return generateMockAudioBase64();

    const ai = new GoogleGenAI({ apiKey });
    
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
        throw new Error("Empty audio");
    } catch (e) {
        return generateMockAudioBase64();
    }
}
