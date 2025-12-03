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
        
        srtContent += `${index + 1}\n`;
        srtContent += `${start} --> ${end}\n`;
        srtContent += `${scene.overlayText}\n\n`; // Using overlayText as subtitle/caption
        
        currentTime += scene.duration;
    });

    return srtContent;
};

export const loadFFmpeg = async (): Promise<FFmpeg> => {
    if (ffmpeg) return ffmpeg;

    const instance = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    
    await instance.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpeg = instance;
    return instance;
};

export const renderVideoWithFFmpeg = async (
    script: GeneratedScript, 
    images: Record<number, string>, // Map of sceneId -> image Blob/URL
    audioBuffers: Record<number, AudioBuffer>,
    onProgress: (p: number, msg: string) => void
): Promise<Blob> => {
    const ff = await loadFFmpeg();
    
    // 1. Write Assets to Virtual FS
    onProgress(10, "Writing assets to memory...");
    
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
        await ff.writeFile(imgName, await fetchFile(images[scene.id]));
        imageFiles.push(imgName);

        // Write Audio (Convert Buffer to WAV)
        const audioName = `audio${i}.wav`;
        const buffer = audioBuffers[scene.id];
        const wavBytes = audioBufferToWav(buffer);
        await ff.writeFile(audioName, wavBytes);
        audioFiles.push(audioName);
    }

    onProgress(30, "Constructing FFmpeg pipeline...");

    // 2. Construct Filter Complex
    // We need to:
    // a) Scale/Crop images to 1080x1920 (Portrait)
    // b) Concatenate Video Streams
    // c) Concatenate Audio Streams
    // d) Burn Subtitles

    let inputArgs: string[] = [];
    let filterComplex = "";
    let concatVideo = "";
    let concatAudio = "";

    // Inputs
    for (let i = 0; i < script.scenes.length; i++) {
        // Image Input (Loop for duration)
        inputArgs.push('-loop', '1', '-t', script.scenes[i].duration.toString(), '-i', imageFiles[i]);
        
        // Audio Input
        inputArgs.push('-i', audioFiles[i]);

        // Filter: Scale & Setsar for Image
        // Inputs are interleaved: 0=img0, 1=aud0, 2=img1, 3=aud1...
        const vIdx = i * 2;
        const aIdx = (i * 2) + 1;

        // Scale to 1080x1920 (Portrait standard for TikTok) with crop
        filterComplex += `[${vIdx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v${i}];`;
        
        concatVideo += `[v${i}]`;
        concatAudio += `[${aIdx}:a]`;
    }

    // Concatenate
    filterComplex += `${concatVideo}concat=n=${script.scenes.length}:v=1:a=0[vbase];`;
    filterComplex += `${concatAudio}concat=n=${script.scenes.length}:v=0:a=1[abase];`;

    // Burn Subtitles
    // Style: Yellow text, bold, bottom center
    const style = "Fontname=Arial,Fontsize=18,PrimaryColour=&H0000FFFF,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=50";
    filterComplex += `[vbase]subtitles=subtitles.srt:force_style='${style}'[vfinal]`;

    const outputName = "output.mp4";

    // 3. Run Command
    onProgress(50, "Rendering video (this may take a moment)...");
    
    await ff.exec([
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vfinal]',
        '-map', '[abase]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast', // Faster encoding for web
        '-pix_fmt', 'yuv420p',  // Compatibility
        '-c:a', 'aac',
        '-b:a', '128k',
        '-r', '30',             // 30 fps
        outputName
    ]);

    onProgress(90, "Finalizing file...");

    // 4. Read Output
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
