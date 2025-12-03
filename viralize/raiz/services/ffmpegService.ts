/// <reference lib="dom" />
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { GeneratedScript } from '../types';

let ffmpeg: FFmpeg | null = null;

// Helper to format time for SRT (00:00:00,000)
const formatSrtTime = (seconds: number): string => {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    return date.toISOString().substr(11, 12).replace('.', ',');
};

// Generate SRT content from script
const generateSubtitleFile = (script: GeneratedScript): string => {
    let srtContent = "";
    let currentTime = 0;

    script.scenes.forEach((scene, index) => {
        const start = formatSrtTime(currentTime);
        const end = formatSrtTime(currentTime + scene.duration);
        
        // Clean text for SRT
        const cleanText = scene.overlayText.replace(/\n/g, ' ').trim();
        
        srtContent += `${index + 1}\n`;
        srtContent += `${start} --> ${end}\n`;
        srtContent += `${cleanText}\n\n`; 
        
        currentTime += scene.duration;
    });

    return srtContent;
};

export const loadFFmpeg = async (onLog?: (msg: string) => void): Promise<FFmpeg> => {
    if (ffmpeg) return ffmpeg;

    const instance = new FFmpeg();
    
    // Enable logging for debugging
    instance.on('log', ({ message }) => {
        console.log('[FFmpeg Log]:', message);
        if (onLog) onLog(message);
    });

    // Use version 0.12.10 to match package.json
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
    
    try {
        await instance.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        ffmpeg = instance;
        return instance;
    } catch (e) {
        console.error("FFmpeg Load Error:", e);
        throw new Error("Failed to load video engine. Check browser compatibility (SharedArrayBuffer).");
    }
};

export const renderVideoWithFFmpeg = async (
    script: GeneratedScript, 
    images: Record<number, string>, // Map of sceneId -> image Blob/URL
    audioBuffers: Record<number, AudioBuffer>,
    onProgress: (p: number, msg: string) => void
): Promise<Blob> => {
    // 1. Load Engine
    onProgress(5, "Loading Video Engine...");
    const ff = await loadFFmpeg((msg) => {
        // Simple progress heuristic based on frame processing logs
        if (msg.includes('frame=')) {
            onProgress(60, "Rendering frames...");
        }
    });
    
    // 2. Load & Mount Font (CRITICAL FOR SUBTITLES)
    onProgress(10, "Loading Fonts...");
    const fontName = 'Roboto-Bold.ttf';
    try {
        // Check if font exists, if not write it
        // We use a reliable CDN for the font
        const fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/apache/roboto/Roboto-Bold.ttf';
        await ff.writeFile(fontName, await fetchFile(fontUrl));
    } catch (e) {
        console.warn("Font load failed, subtitles might be missing styling", e);
    }

    // 3. Write Assets to Virtual FS
    onProgress(20, "Writing assets to memory...");
    
    const imageFiles: string[] = [];
    const audioFiles: string[] = [];

    // Write Subtitle File
    const srtContent = generateSubtitleFile(script);
    await ff.writeFile('subtitles.srt', srtContent);

    // Process Scenes
    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        
        // Write Image
        const imgName = `img${i}.jpg`;
        if (!images[scene.id]) throw new Error(`Missing image for scene ${i+1}`);
        await ff.writeFile(imgName, await fetchFile(images[scene.id]));
        imageFiles.push(imgName);

        // Write Audio (Convert Buffer to WAV)
        const audioName = `audio${i}.wav`;
        const buffer = audioBuffers[scene.id];
        if (!buffer) throw new Error(`Missing audio for scene ${i+1}`);
        
        const wavBytes = audioBufferToWav(buffer);
        await ff.writeFile(audioName, wavBytes);
        audioFiles.push(audioName);
    }

    onProgress(30, "Constructing FFmpeg pipeline...");

    // 4. Construct Filter Complex
    let inputArgs: string[] = [];
    let filterComplex = "";
    let concatVideoParts = "";
    let concatAudioParts = "";

    // Inputs: All images first, then all audios
    // Strategy: 
    // Inputs [0..N-1] are images
    // Inputs [N..2N-1] are audios
    
    // Add Images
    script.scenes.forEach((scene, i) => {
        inputArgs.push('-loop', '1', '-t', scene.duration.toString(), '-i', imageFiles[i]);
    });

    // Add Audios
    script.scenes.forEach((scene, i) => {
        inputArgs.push('-i', audioFiles[i]);
    });

    const N = script.scenes.length;

    // Filter Logic
    for (let i = 0; i < N; i++) {
        // Video Filter: Scale to 1080x1920 (Portrait), Crop, Set SAR
        // Index i is the image
        filterComplex += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v${i}];`;
        concatVideoParts += `[v${i}]`;

        // Audio Filter: 
        // Index N+i is the audio
        // We trim/pad audio to match exact scene duration
        const duration = script.scenes[i].duration;
        // apad adds silence if too short, atrim cuts if too long
        filterComplex += `[${N+i}:a]apad,atrim=0:${duration}[a${i}];`;
        concatAudioParts += `[a${i}]`;
    }

    // Concatenate
    filterComplex += `${concatVideoParts}concat=n=${N}:v=1:a=0[vbase];`;
    filterComplex += `${concatAudioParts}concat=n=${N}:v=0:a=1[abase];`;

    // Burn Subtitles
    // force_style uses the loaded font file path
    // 'fontsdir=/' tells FFmpeg to look in root of MemFS for fonts
    const style = `Fontname=Roboto,Fontsize=24,PrimaryColour=&H00FFFF,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=100`;
    filterComplex += `[vbase]subtitles=subtitles.srt:fontsdir=/:force_style='${style}'[vfinal]`;

    const outputName = "output.mp4";

    // 5. Run Command
    onProgress(50, "Rendering video (High CPU Usage)...");
    
    // Cleanup previous run
    try { await ff.deleteFile(outputName); } catch (e) {}

    await ff.exec([
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vfinal]',
        '-map', '[abase]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast', // Speed over compression size
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-r', '30',
        '-shortest', // Stop when the shortest stream ends (safety)
        outputName
    ]);

    onProgress(90, "Finalizing file...");

    // 6. Read Output
    const data = await ff.readFile(outputName);
    return new Blob([data], { type: 'video/mp4' });
};

// Util: Convert Web Audio API Buffer to WAV bytes for FFmpeg
function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    let result: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) {
        result.push(buffer.getChannelData(i));
    }

    // Interleave
    const length = buffer.length * numChannels * 2;
    const bufferData = new Int16Array(length / 2);
    let offset = 0;
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, result[channel][i]));
            // 0x7FFF = 32767
            bufferData[offset] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            offset++;
        }
    }

    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + bufferData.byteLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, bufferData.byteLength, true);

    const wavBytes = new Uint8Array(wavHeader.byteLength + bufferData.byteLength);
    wavBytes.set(new Uint8Array(wavHeader), 0);
    wavBytes.set(new Uint8Array(bufferData.buffer), 44);

    return wavBytes;
}
