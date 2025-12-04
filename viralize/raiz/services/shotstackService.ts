import { GeneratedScript, Scene } from "../types";
import { getStockImage } from "./geminiService";

// --- SHOTSTACK CONFIG ---
const SHOTSTACK_API_URL = "https://api.shotstack.io/edit/stage/render";

export const getShotstackKey = (): string => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem('SHOTSTACK_API_KEY') || "";
    }
    return "";
};

export const setShotstackKey = (key: string) => {
    localStorage.setItem('SHOTSTACK_API_KEY', key);
    window.location.reload();
};

// --- PAYLOAD BUILDER ---
const buildShotstackPayload = async (script: GeneratedScript) => {
    const videoClips: any[] = [];
    const audioClips: any[] = [];
    const textClips: any[] = [];
    
    let startTime = 0;

    // Resolve Image URLs first
    const imageUrls = await Promise.all(
        script.scenes.map(async (s) => {
            try {
                const url = await getStockImage(s.imageKeyword);
                // Shotstack needs public URLs. Pexels/Picsum are public.
                return url;
            } catch (e) {
                return `https://picsum.photos/seed/${s.id}/1920/1080`;
            }
        })
    );

    script.scenes.forEach((scene, index) => {
        const duration = scene.duration;
        const imageUrl = imageUrls[index];

        // 1. VIDEO TRACK (Images)
        videoClips.push({
            asset: {
                type: "image",
                src: imageUrl
            },
            start: startTime,
            length: duration,
            effect: "zoomIn", // Ken Burns effect
            transition: {
                in: "fade",
                out: "fade"
            }
        });

        // 2. AUDIO TRACK (Internal TTS)
        // We use Shotstack's TTS engine to guarantee audio exists in the file
        audioClips.push({
            asset: {
                type: "text-to-speech",
                text: scene.narration,
                voice: "Matthew" // Standard Voice
            },
            start: startTime
        });

        // 3. OVERLAY TRACK (HTML/Text)
        textClips.push({
            asset: {
                type: "html",
                html: `<p data-effect="slide-up" style="font-family: Montserrat; font-weight: 800; font-size: 48px; color: #FFFFFF; text-align: center; text-shadow: 2px 2px 4px #000000;">${scene.overlayText.toUpperCase()}</p>`,
                css: "p { margin: 0; }"
            },
            start: startTime,
            length: duration,
            position: "center"
        });

        startTime += duration;
    });

    return {
        timeline: {
            background: "#000000",
            tracks: [
                { clips: textClips },  // Top Layer: Text
                { clips: videoClips }, // Middle Layer: Video
                { clips: audioClips }  // Bottom Layer: Audio
            ]
        },
        output: {
            format: "mp4",
            resolution: "sd", // SD is faster for free tier/testing
            aspectRatio: "9:16", // Vertical for TikTok/Reels
            fps: 30
        }
    };
};

export const renderWithShotstack = async (script: GeneratedScript, onStatus: (msg: string) => void): Promise<string> => {
    const apiKey = getShotstackKey();
    if (!apiKey) throw new Error("Missing Shotstack API Key");

    onStatus("Preparing Assets for Cloud Render...");
    const payload = await buildShotstackPayload(script);

    // 1. POST TO RENDER
    onStatus("Sending to Render Server...");
    const postRes = await fetch(SHOTSTACK_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey
        },
        body: JSON.stringify(payload)
    });

    if (!postRes.ok) {
        const err = await postRes.json();
        throw new Error(`Shotstack Error: ${err.message || postRes.statusText}`);
    }

    const postData = await postRes.json();
    const renderId = postData.response.id;
    onStatus(`Rendering ID: ${renderId} (This happens in the cloud)...`);

    // 2. POLL FOR COMPLETION
    let attempts = 0;
    while (attempts < 30) { // Timeout after ~60s
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s
        attempts++;

        const getRes = await fetch(`${SHOTSTACK_API_URL}/${renderId}`, {
            headers: { "x-api-key": apiKey }
        });
        
        const getData = await getRes.json();
        const status = getData.response.status;
        
        onStatus(`Cloud Status: ${status}...`);

        if (status === "done") {
            return getData.response.url; // The final MP4 URL
        } else if (status === "failed") {
            throw new Error("Cloud Render Failed on Shotstack side.");
        }
    }

    throw new Error("Render Timed Out");
};
