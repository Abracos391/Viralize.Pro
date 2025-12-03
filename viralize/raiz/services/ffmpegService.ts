/// <reference lib="dom" />
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { GeneratedScript } from '../types';

let ffmpeg: FFmpeg | null = null;

// Load FFmpeg - VERSION SYNCED TO 0.12.10
export const loadFFmpeg = async (onLog?: (msg: string) => void): Promise<FFmpeg> => {
    if (ffmpeg) return ffmpeg;
    const instance = new FFmpeg();
    instance.on('log', ({ message }) => { 
        console.log("FFmpeg:", message);
        if (onLog) onLog(message); 
    });
    
    // IMPORTANT: Version must match package.json exactly to avoid memory crashes
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    
    try {
        await instance.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        ffmpeg = instance;
        return instance;
    } catch (e: any) {
        console.error("FFmpeg Load Error:", e);
        // Fallback or re-throw
        throw new Error(`Video Engine Load Failed. Check network or COOP/COEP headers. Details: ${e.message}`);
    }
};

export const renderVideoWithFFmpeg = async (
    script: GeneratedScript, 
    imagesWithText: Record<number, Uint8Array>,
    masterAudioWav: Uint8Array,
    onProgress: (p: number, msg: string) => void
): Promise<Blob> => {
    
    onProgress(10, "Initializing Engine...");
    const ff = await loadFFmpeg((msg) => { 
        if (msg.includes('frame=')) onProgress(70, "Encoding..."); 
    });
    
    // 1. CLEANUP PREVIOUS RUN
    try {
        await ff.deleteFile('audio.wav');
        await ff.deleteFile('output.mp4');
        const files = await ff.listDir('/');
        for (const f of files) {
            if (f.name.endsWith('.jpg')) await ff.deleteFile(f.name);
        }
    } catch(e) {}

    // 2. WRITE ASSETS
    onProgress(30, "Writing Assets...");
    const imageFiles: string[] = [];

    // Write Master Audio
    await ff.writeFile('audio.wav', masterAudioWav);

    // Write Images
    let validImageCount = 0;
    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const imgName = `img${i}.jpg`;
        const imgData = imagesWithText[scene.id];
        
        if (imgData && imgData.byteLength > 0) {
            await ff.writeFile(imgName, imgData);
            imageFiles.push(imgName);
            validImageCount++;
        } else {
            throw new Error(`Critical: Missing image data for scene ${i+1}`);
        }
    }

    if (validImageCount !== script.scenes.length) {
        throw new Error("Asset mismatch: Not all scenes have images.");
    }

    // 3. GENERATE VIDEO COMMAND
    onProgress(50, "Generating Video...");
    
    let inputArgs: string[] = [];
    script.scenes.forEach((s, i) => {
        // Loop 1 = static image
        inputArgs.push('-loop', '1', '-t', s.duration.toString(), '-i', imageFiles[i]);
    });
    
    // FILTER COMPLEX: Just concat visual streams. No scaling needed (images are pre-scaled).
    let filterComplex = "";
    for(let i=0; i<script.scenes.length; i++) {
        // We use setsar=1 to force 1:1 pixel aspect ratio
        filterComplex += `[${i}:v]setsar=1[v${i}];`;
    }
    
    let concatStr = "";
    for(let i=0; i<script.scenes.length; i++) concatStr += `[v${i}]`;
    
    filterComplex += `${concatStr}concat=n=${script.scenes.length}:v=1:a=0[vbase];`;

    const outputName = "output.mp4";
    const audioInputIndex = script.scenes.length; // Audio is the Nth input (0-based)

    // EXECUTE
    // -i audio.wav is added LAST
    await ff.exec([
        ...inputArgs,
        '-i', 'audio.wav', 
        '-filter_complex', filterComplex,
        '-map', '[vbase]',       
        '-map', `${audioInputIndex}:a`, 
        '-c:v', 'libx264',
        '-preset', 'ultrafast',  
        '-pix_fmt', 'yuv420p',   // Required for compatibility
        '-c:a', 'aac',           
        '-ac', '2',              // Force Stereo
        '-ar', '44100',          // Force Sample Rate
        '-shortest',             
        outputName
    ]);

    onProgress(95, "Finalizing...");
    const data = await ff.readFile(outputName);
    
    if (data.byteLength < 1000) {
        throw new Error("Generation Failed: Output file is empty.");
    }

    return new Blob([data], { type: 'video/mp4' });
};

// --- FIXED WAV HEADER GENERATOR ---
// DYNAMICALLY ADAPTS TO SAMPLE RATE TO PREVENT SILENCE
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
    const numChannels = 2; // Output Stereo
    const sampleRate = buffer.sampleRate; // USE ACTUAL BUFFER RATE
    const format = 1; // PCM
    const bitDepth = 16;
    
    const length = buffer.length * numChannels;
    const result = new Int16Array(length);
    
    const chan0 = buffer.getChannelData(0);
    const chan1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chan0;

    let offset = 0;
    for (let i = 0; i < buffer.length; i++) {
        // Interleave L/R
        const s0 = Math.max(-1, Math.min(1, chan0[i]));
        result[offset++] = s0 < 0 ? s0 * 0x8000 : s0 * 0x7FFF;
        
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
