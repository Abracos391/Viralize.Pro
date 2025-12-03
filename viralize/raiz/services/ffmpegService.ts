/// <reference lib="dom" />
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { GeneratedScript } from '../types';

let ffmpeg: FFmpeg | null = null;

// Load FFmpeg from a reliable CDN
export const loadFFmpeg = async (onLog?: (msg: string) => void): Promise<FFmpeg> => {
    if (ffmpeg) return ffmpeg;
    const instance = new FFmpeg();
    instance.on('log', ({ message }) => { if (onLog) onLog(message); });
    
    // Using jsDelivr for better stability and CORS headers
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    
    try {
        await instance.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        ffmpeg = instance;
        return instance;
    } catch (e: any) {
        console.error("FFmpeg Load Error:", e);
        throw new Error(`Video Engine Load Failed: ${e.message}`);
    }
};

export const renderVideoWithFFmpeg = async (
    script: GeneratedScript, 
    // Images now contain the BURNED-IN text. No subtitle filter needed.
    imagesWithText: Record<number, Uint8Array>,
    masterAudioWav: Uint8Array,
    onProgress: (p: number, msg: string) => void
): Promise<Blob> => {
    
    onProgress(10, "Initializing Engine...");
    const ff = await loadFFmpeg((msg) => { 
        if (msg.includes('frame=')) onProgress(70, "Encoding Video..."); 
    });
    
    // 1. Write Assets
    onProgress(30, "Preparing Assets...");
    const imageFiles: string[] = [];

    // Write Master Audio
    await ff.writeFile('audio.wav', masterAudioWav);

    // Write Pre-Rendered Images (Visual + Text)
    // IMPORTANT: Verify we have data for every scene
    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const imgName = `img${i}.jpg`;
        const imgData = imagesWithText[scene.id];
        
        if (!imgData || imgData.byteLength === 0) {
            console.error(`Missing image data for scene ${i}`);
            // Fallback: Create a black frame if missing to prevent FFmpeg crash
            // We shouldn't get here due to VideoPlayer fallback, but safe > sorry
        } else {
            await ff.writeFile(imgName, imgData);
            imageFiles.push(imgName);
        }
    }

    // 2. Generate Video Command (Simple Concat)
    // We are NOT using subtitle filters or font files anymore. 
    // The images already have the text.
    onProgress(50, "Generating Video...");
    
    let inputArgs: string[] = [];
    script.scenes.forEach((s, i) => {
        // Loop each image for its specific duration
        inputArgs.push('-loop', '1', '-t', s.duration.toString(), '-i', imageFiles[i]);
    });
    
    // Complex Filter: Scale inputs to 1080x1920 (just in case) and Concat
    let filterComplex = "";
    for(let i=0; i<script.scenes.length; i++) {
        // Simple scaling to ensure standard dimensions
        filterComplex += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v${i}];`;
    }
    
    let concatStr = "";
    for(let i=0; i<script.scenes.length; i++) concatStr += `[v${i}]`;
    
    // Concat all video streams
    filterComplex += `${concatStr}concat=n=${script.scenes.length}:v=1:a=0[vbase];`;

    const outputName = "output.mp4";
    try { await ff.deleteFile(outputName); } catch (e) {}

    // 3. EXECUTE - Single Pass (Video Generation + Audio Merge)
    // We map the concatenated video [vbase] and the external audio file (index N, where N is num scenes)
    const audioInputIndex = script.scenes.length;

    await ff.exec([
        ...inputArgs,
        '-i', 'audio.wav', // Audio is the last input
        '-filter_complex', filterComplex,
        '-map', '[vbase]',       // Mapped Video
        '-map', `${audioInputIndex}:a`, // Mapped Audio
        '-c:v', 'libx264',
        '-preset', 'ultrafast',  // Fast encoding
        '-pix_fmt', 'yuv420p',   // Standard compatibility
        '-c:a', 'aac',           // Standard audio
        '-ac', '2',              // FORCE STEREO: Fixes silent audio on some players
        '-b:a', '192k',
        '-shortest',             // Ensure video matches audio length
        outputName
    ]);

    onProgress(95, "Finalizing File...");
    const data = await ff.readFile(outputName);
    
    // Cleanup
    try {
        await ff.deleteFile("audio.wav");
        imageFiles.forEach(async f => { try { await ff.deleteFile(f) } catch(e){} });
    } catch(e) {}

    return new Blob([data], { type: 'video/mp4' });
};

// --- HELPER: WAV HEADER GENERATOR (STEREO 44.1kHz) ---
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
    const numChannels = 2; // FORCE 2 Channels (Stereo) for compatibility
    const sampleRate = 44100; 
    const format = 1; // PCM
    const bitDepth = 16;
    
    // Create new buffer if input is mono, or mix down
    const length = buffer.length * numChannels;
    const result = new Int16Array(length);
    
    const chan0 = buffer.getChannelData(0);
    const chan1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chan0; // Duplicate mono to stereo

    let offset = 0;
    for (let i = 0; i < buffer.length; i++) {
        // Left
        const s0 = Math.max(-1, Math.min(1, chan0[i]));
        result[offset++] = s0 < 0 ? s0 * 0x8000 : s0 * 0x7FFF;
        // Right
        const s1 = Math.max(-1, Math.min(1, chan1[i]));
        result[offset++] = s1 < 0 ? s1 * 0x8000 : s1 * 0x7FFF;
    }

    const bufferData = new Uint8Array(result.buffer);
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + bufferData.byteLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, bufferData.byteLength, true);

    const wavBytes = new Uint8Array(wavHeader.byteLength + bufferData.byteLength);
    wavBytes.set(new Uint8Array(wavHeader), 0);
    wavBytes.set(bufferData, 44);

    return wavBytes;
}
