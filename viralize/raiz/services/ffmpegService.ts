// This service is obsolete as we switched to Native MediaRecorder.
// Keeping file as a stub to prevent import errors if referenced elsewhere,
// but functionality is disabled.

import { GeneratedScript } from '../types';

export const loadFFmpeg = async () => {
    console.warn("FFmpeg is disabled in this version.");
    return null;
};

export const renderVideoWithFFmpeg = async (
    script: GeneratedScript, 
    imagesWithText: any,
    masterAudioWav: any,
    onProgress: (p: number, msg: string) => void
): Promise<Blob> => {
    throw new Error("FFmpeg rendering is disabled. Please use the native 'Mix & Download' button.");
};
