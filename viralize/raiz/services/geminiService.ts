import { GoogleGenAI, Modality } from "@google/genai";
import { VideoInputData, GeneratedScript, DurationOption } from "../types";

// Simple string hash for cache keys
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
        // LocalStorage might be full, ignore
        console.warn("Cache storage failed", e);
    }
};

const parseJSON = (text: string) => {
    try {
        // Remove markdown code blocks if present
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("Failed to parse Gemini JSON:", e);
        throw new Error("Failed to parse generation result.");
    }
};

export const generateVideoScript = async (input: VideoInputData): Promise<GeneratedScript> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const numScenes = input.duration === DurationOption.SHORT ? 6 : 10;
  
  const systemInstruction = `
    You are the "Viralize Pro" AI engine. 
    Your goal is to generate high-retention video scripts for static-image slideshows.
    Focus on:
    1. Hook (First 2.5s)
    2. Value/Problem Agitation
    3. Solution/Benefit
    4. CTA (Last slide)
    
    Format: JSON only.
  `;

  const prompt = `
    GENERATE A VIDEO SCRIPT BASED ON THESE INPUTS:
    Product: ${input.productName}
    Description: ${input.description}
    Target Audience: ${input.targetAudience}
    Platform: ${input.platform}
    Total Duration: ${input.duration} (${numScenes} images)

    STRICT RULES:
    1. Return valid JSON only.
    2. "scenes" array must have exactly ${numScenes} items.
    3. "duration" for scenes must sum up to approx ${input.duration === DurationOption.SHORT ? 15 : 30}.
    4. "imageKeyword" must be a single English word to search for a stock photo (e.g., "fitness", "gym", "happy").
    5. Scene 1 is the HOOK (1.5s-2.5s).
    6. The last scene is the CTA (3.5s-4.5s).

    JSON SCHEMA:
    {
      "title": "Catchy Internal Title",
      "tone": "Brief description of tone",
      "seoKeywords": ["keyword1", "keyword2"],
      "hashtags": ["#tag1", "#tag2"],
      "estimatedViralScore": number (0-100),
      "scenes": [
        {
          "id": 1,
          "duration": number (float),
          "narration": "Spoken text for TTS",
          "overlayText": "Short punchy text for screen",
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
    // 1. Check Cache first
    const cached = getCachedAudio(text);
    if (cached) {
        if (onRetry) onRetry("Loaded from cache");
        return cached;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // EXTREME PERSISTENCE STRATEGY (V2 - "Never Give Up")
    // Free tier limits are strictly enforced. We must wait them out.
    // 50 retries with 30s wait = 25 minutes of patience.
    const MAX_RETRIES = 50;
    
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
                // Save to cache
                setCachedAudio(text, audioData);
                return audioData;
            }
            
            throw new Error("API returned empty audio data");

        } catch (e: any) {
            console.warn(`TTS Attempt ${attempt}/${MAX_RETRIES} failed:`, e.message);
            lastError = e;

            // Check if it's a "Quota" or "Rate Limit" error (429 or 503)
            const isRateLimit = e.message?.includes('429') || e.message?.includes('503') || e.message?.includes('quota') || e.message?.includes('resource exhausted');
            
            // If it's the last attempt, fail.
            if (attempt === MAX_RETRIES) break;

            // EXTREME BACKOFF STRATEGY
            // If rate limited, wait 30 seconds FULL. This clears the 15 RPM window.
            const waitTime = isRateLimit ? 30000 : 5000 + (attempt * 1000);
            
            if (onRetry) {
                const timeLeft = Math.round(waitTime/1000);
                onRetry(isRateLimit ? `API Limit (Free Tier). Cooldown: ${timeLeft}s...` : `Retrying connection (${attempt}/${MAX_RETRIES})...`);
            }

            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    throw lastError || new Error("Failed to generate audio content after multiple retries");
}
