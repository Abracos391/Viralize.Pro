import { GoogleGenAI, Modality } from "@google/genai";
import { VideoInputData, GeneratedScript, DurationOption, ComplianceResult, MarketingGoal } from "../types";

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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
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
        // Fail open but warn
        return { isSafe: true, flaggedCategories: [], reason: "AI check failed", suggestion: "" };
    }
};

export const fetchTrendingKeywords = async (niche: string): Promise<string[]> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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

    if (!pexelsKey || pexelsKey.length < 10) return fallbackUrl;

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
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const numScenes = input.duration === DurationOption.SHORT ? 6 : 10;
  
  const systemInstruction = `
    You are "Viralize Pro", an AI marketing expert.
    GOAL: ${input.marketingGoal}.
    
    STRATEGY BASED ON GOAL:
    - SALES: Focus on pain points, immediate solution, scarcity, and direct "Buy Now" CTA.
    - TRAFFIC: Create curiosity gaps ("Link in bio to see how"), teaser content.
    - ENGAGEMENT: Ask questions, use controversial/funny hooks, "Comment 'Yes' if...".
    - AWARENESS: Focus on brand values, aesthetic, emotional connection.

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

export const generateNarration = async (text: string, onRetry?: (msg: string) => void): Promise<string> => {
    const cached = getCachedAudio(text);
    if (cached) {
        if (onRetry) onRetry("Loaded from cache");
        return cached;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const MAX_RETRIES = 50; // No Fail Protocol
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
            const waitTime = isRateLimit ? 30000 : 5000 + (attempt * 1000);
            
            if (onRetry) {
                const timeLeft = Math.round(waitTime/1000);
                onRetry(isRateLimit ? `Google API Traffic. Waiting ${timeLeft}s...` : `Retrying connection (${attempt})...`);
            }
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    throw lastError || new Error("Failed to generate audio.");
}
