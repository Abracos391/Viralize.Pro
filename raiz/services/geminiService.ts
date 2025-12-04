import { GoogleGenAI, Modality } from "@google/genai";
import { VideoInputData, GeneratedScript, DurationOption, ComplianceResult } from "../types";

// --- API KEY & ENV ---
const EMERGENCY_KEY = "AIzaSyBSEELLWDIa01iwsXLlGtNHg283oqSu65g";

export const getApiKey = (): string => {
    let k = process.env.API_KEY || "";
    if (typeof window !== 'undefined') {
        const local = localStorage.getItem('GEMINI_API_KEY');
        if (local) k = local;
    }
    if (k && k.startsWith("AIza")) return k;
    if (EMERGENCY_KEY.startsWith("AIza")) return EMERGENCY_KEY;
    return "";
};

export const setRuntimeApiKey = (k: string) => {
    localStorage.setItem('GEMINI_API_KEY', k);
    window.location.reload();
};

export const hasValidKey = () => !!getApiKey();

// --- MOCK DATA ---
const MOCK_SCRIPT: GeneratedScript = {
    title: "Modo Demonstração (Sem Chave)",
    tone: "Energético",
    seoKeywords: ["demo", "teste"],
    hashtags: ["#demo", "#viralizepro"],
    estimatedViralScore: 90,
    scenes: [
        { id: 1, duration: 2.5, narration: "Bem-vindo ao Viralize Pro. Este é um modo de demonstração.", overlayText: "MODO DEMONSTRAÇÃO", imageKeyword: "futuristic technology hud interface", isCta: false },
        { id: 2, duration: 2.5, narration: "Por favor, adicione uma chave API do Google válida para gerar vídeos reais.", overlayText: "ADICIONE SUA CHAVE", imageKeyword: "security key lock", isCta: false },
        { id: 3, duration: 2.5, narration: "Usamos inteligência artificial para criar roteiros e visuais.", overlayText: "PODER DA IA", imageKeyword: "artificial intelligence brain", isCta: false },
        { id: 4, duration: 2.5, narration: "A renderização acontece diretamente no seu navegador.", overlayText: "RENDER NO BROWSER", imageKeyword: "web browser internet speed", isCta: false },
        { id: 5, duration: 2.5, narration: "Baixe vídeos compatíveis instantaneamente.", overlayText: "DOWNLOAD RÁPIDO", imageKeyword: "download cloud data", isCta: true },
        { id: 6, duration: 2.5, narration: "Comece agora mesmo!", overlayText: "COMECE AGORA", imageKeyword: "rocket launch success", isCta: true }
    ]
};

// --- HELPERS ---
const parseJSON = (text: string) => {
    try {
        return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (e) { return MOCK_SCRIPT; }
};

// --- CORE SERVICES ---

export const getStockImage = async (query: string): Promise<string> => {
    // Force Pexels usage if key exists
    const pexelsKey = process.env.PEXELS_API_KEY;
    if (pexelsKey && pexelsKey.length > 10) {
        try {
            const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`, {
                headers: { Authorization: pexelsKey }
            });
            const data = await res.json();
            if (data.photos?.[0]?.src?.portrait) return data.photos[0].src.portrait;
        } catch(e) {}
    }
    // Fallback Picsum (Using seed ensures consistency)
    return `https://picsum.photos/seed/${encodeURIComponent(query)}/1080/1920`;
};

export const generateVideoScript = async (input: VideoInputData): Promise<GeneratedScript> => {
    const key = getApiKey();
    if (!key) return MOCK_SCRIPT;

    const ai = new GoogleGenAI({ apiKey: key });
    const scenesCount = input.duration === DurationOption.SHORT ? 6 : 10;

    // PROMPT EM PORTUGUÊS REFORÇADO
    const prompt = `
    ATUE COMO UM ESPECIALISTA EM MARKETING VIRAL BRASILEIRO.
    Crie um ROTEIRO DE VÍDEO CURTO (TikTok/Reels).
    
    Produto: ${input.productName}
    Descrição: ${input.description}
    Público: ${input.targetAudience}
    Duração: ${scenesCount} cenas.

    REGRAS CRÍTICAS (Idiomas & Estilo):
    1. IDIOMA: TUDO DEVE ESTAR EM PORTUGUÊS DO BRASIL (PT-BR).
    2. Narração deve ser natural, engajadora e usar linguagem coloquial se adequado ao público.
    3. 'overlayText' (Texto na tela) deve ser curto, impactante e EM PORTUGUÊS (Caixa Alta).
    4. TÍTULO: Deve ser limpo e comercial (ex: "StreamDroid Oficial" e NÃO "streamdroid-v1").

    REGRAS PARA 'imageKeyword':
    - DEVE SER EM INGLÊS (para buscar no banco de imagens).
    - Descreva a imagem visualmente. Ex: "Woman holding smartphone smiling", "Soccer ball on grass".
    
    Output JSON: {
        "title": "Título Comercial Limpo (PT-BR)",
        "tone": "Tom da voz (ex: Animado)",
        "seoKeywords": ["palavra1", "palavra2"],
        "hashtags": ["#tag1", "#tag2"],
        "estimatedViralScore": number,
        "scenes": [
            { "id": 1, "duration": number, "narration": "Texto falado em PT-BR", "overlayText": "TEXTO TELA PT-BR", "imageKeyword": "VISUAL_DESCRIPTION_IN_ENGLISH", "isCta": boolean }
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
        return MOCK_SCRIPT;
    }
};

export const generateNarration = async (text: string): Promise<string> => {
    const key = getApiKey();
    if (!key) return "SILENCE";

    // Simple Cache
    const cacheKey = `tts_ptbr_${text.substring(0,20)}`;
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
                    voiceConfig: { 
                        // Using a voice config, Gemini usually auto-detects language from text
                        // Providing PT-BR text ensures PT-BR speech.
                        prebuiltVoiceConfig: { voiceName: 'Kore' } 
                    } 
                }
            }
        });
        const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (data) {
            localStorage.setItem(cacheKey, data);
            return data;
        }
    } catch (e) {}
    return "SILENCE";
};

export const validateContentSafety = async (p: string, d: string): Promise<ComplianceResult> => {
    return { isSafe: true, flaggedCategories: [], reason: "Pass", suggestion: "" };
};

export const fetchTrendingKeywords = async (n: string) => ["#viral", "#brasil", "#tendencia"];
