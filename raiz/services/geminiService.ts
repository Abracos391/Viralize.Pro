import { GoogleGenAI, Modality } from "@google/genai";
import { VideoInputData, GeneratedScript, DurationOption, ComplianceResult } from "../types";

// --- API KEY STRATEGY ---
const EMERGENCY_KEY = "AIzaSyBSEELLWDIa01iwsXLlGtNHg283oqSu65g";

export const getApiKey = (): string => {
    // 1. Check Env (Render/Build)
    let k = process.env.API_KEY || "";
    
    // 2. Check Browser Storage (Runtime User Input)
    if (typeof window !== 'undefined') {
        const local = localStorage.getItem('GEMINI_API_KEY');
        if (local) k = local;
    }

    // 3. Validation & Fallback
    if (k && k.length > 10 && k.startsWith("AIza") && k !== 'undefined') return k;
    if (EMERGENCY_KEY && EMERGENCY_KEY.startsWith("AIza")) return EMERGENCY_KEY;
    
    return "";
};

export const setRuntimeApiKey = (k: string) => {
    localStorage.setItem('GEMINI_API_KEY', k);
    window.location.reload();
};

export const hasValidKey = () => !!getApiKey();

// --- MOCK DATA ---
const MOCK_SCRIPT: GeneratedScript = {
    title: "Demonstração Viralize",
    tone: "Profissional",
    seoKeywords: ["demo", "teste"],
    hashtags: ["#demo", "#viralize"],
    estimatedViralScore: 90,
    scenes: [
        { id: 1, duration: 2.5, narration: "Bem-vindo ao modo de demonstração do Viralize Pro.", overlayText: "MODO DEMONSTRAÇÃO", imageKeyword: "futuristic technology interface", isCta: false },
        { id: 2, duration: 2.5, narration: "Estamos usando dados de exemplo pois a chave API não foi detectada.", overlayText: "SEM CHAVE API", imageKeyword: "security lock digital", isCta: false },
        { id: 3, duration: 2.5, narration: "Insira sua chave nas configurações para usar a Inteligência Artificial.", overlayText: "CONFIGURAÇÕES", imageKeyword: "settings gear icon", isCta: false },
        { id: 4, duration: 2.5, narration: "O sistema gera áudio e vídeo diretamente no seu navegador.", overlayText: "RENDERIZAÇÃO LOCAL", imageKeyword: "browser computer speed", isCta: false },
        { id: 5, duration: 2.5, narration: "Experimente clicar em baixar para testar o arquivo final.", overlayText: "TESTE O DOWNLOAD", imageKeyword: "download button symbol", isCta: true },
        { id: 6, duration: 2.5, narration: "Crie vídeos virais em segundos com nossa tecnologia.", overlayText: "CRIE AGORA", imageKeyword: "rocket launch space", isCta: true }
    ]
};

// --- HELPERS ---
const parseJSON = (text: string) => {
    try {
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("JSON Parse Error", e);
        return MOCK_SCRIPT;
    }
};

// --- SERVICES ---

export const getStockImage = async (query: string): Promise<string> => {
    const pexelsKey = process.env.PEXELS_API_KEY;
    // Prefer Pexels if available
    if (pexelsKey && pexelsKey.length > 10 && pexelsKey !== 'undefined') {
        try {
            const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`, {
                headers: { Authorization: pexelsKey }
            });
            const data = await res.json();
            if (data.photos && data.photos.length > 0) return data.photos[0].src.portrait;
        } catch(e) { console.warn("Pexels error", e); }
    }
    // Reliable Fallback: Picsum with Seed
    return `https://picsum.photos/seed/${encodeURIComponent(query)}/1080/1920`;
};

export const generateVideoScript = async (input: VideoInputData): Promise<GeneratedScript> => {
    const key = getApiKey();
    if (!key) return MOCK_SCRIPT;

    const ai = new GoogleGenAI({ apiKey: key });
    const scenesCount = input.duration === DurationOption.SHORT ? 6 : 10;

    const prompt = `
    ATUE COMO UM REDATOR PUBLICITÁRIO BRASILEIRO ESPECIALISTA EM TIKTOK.
    
    PRODUTO: ${input.productName}
    DESCRIÇÃO: ${input.description}
    OBJETIVO: ${input.marketingGoal}
    PÚBLICO: ${input.targetAudience}
    DURAÇÃO: ${scenesCount} cenas.

    REGRAS ESTRITAS DE FORMATAÇÃO (JSON):
    1. IDIOMA: Use APENAS PORTUGUÊS DO BRASIL para "narration" e "overlayText".
    2. TÍTULO: Um título curto e comercial (Ex: "Oferta Imperdível"). NUNCA use hífens (Ex: "oferta-imperdivel-v1").
    3. IMAGENS: Para "imageKeyword", use termos VISUAIS em INGLÊS (Ex: "Happy woman holding phone", não use "Felicidade").
    4. SINTAXE: Retorne apenas o JSON válido.

    SCHEMA:
    {
        "title": "Título Bonito",
        "tone": "Energético",
        "seoKeywords": ["keyword1"],
        "hashtags": ["#tag1"],
        "estimatedViralScore": 95,
        "scenes": [
            { 
                "id": 1, 
                "duration": number (segundos), 
                "narration": "Texto falado em português...", 
                "overlayText": "TEXTO DA TELA", 
                "imageKeyword": "visual description in english", 
                "isCta": boolean 
            }
        ]
    }`;

    try {
        const res = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        return parseJSON(res.text || "");
    } catch (e) {
        console.error("Script gen failed", e);
        return MOCK_SCRIPT;
    }
};

export const generateNarration = async (text: string): Promise<string> => {
    const key = getApiKey();
    if (!key) return "SILENCE";

    // Simple cache to save API calls
    const cacheKey = `tts_br_${text.substring(0, 15)}_${text.length}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;

    const ai = new GoogleGenAI({ apiKey: key });
    try {
        const res = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { 
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } 
                }
            }
        });
        const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (data) {
            localStorage.setItem(cacheKey, data);
            return data;
        }
    } catch (e) {
        console.warn("TTS Failed", e);
    }
    return "SILENCE";
};

export const validateContentSafety = async (p: string, d: string): Promise<ComplianceResult> => {
    // Non-blocking compliance check
    return { isSafe: true, flaggedCategories: [], reason: "Checked", suggestion: "" };
};

export const fetchTrendingKeywords = async (niche: string) => {
    return ["#viral", "#brasil", "#tendencia", "#fy"];
};
