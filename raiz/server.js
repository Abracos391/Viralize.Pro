import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import cors from 'cors';
import multer from 'multer';

// 1. CONFIGURAÇÃO BÁSICA
const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. CONFIGURAR ENGINE DE VÍDEO (FFMPEG NATIVO)
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log(`[System] Engine de Vídeo Carregado: ${ffmpegPath}`);
} else {
    console.error("[System] ERRO CRÍTICO: Binário do FFmpeg não encontrado.");
}

app.use(cors());
app.use(express.json());

// 3. DIRETÓRIOS DE TRABALHO (Staging Area)
let DIST_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(DIST_DIR)) DIST_DIR = path.join(process.cwd(), 'dist');

const UPLOADS_DIR = path.join(process.cwd(), 'temp_uploads');
const OUTPUT_DIR = path.join(process.cwd(), 'public_videos');

// Criar pastas se não existirem
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 4. CONFIGURAÇÃO DE UPLOAD (MULTER)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const jobId = req.body.jobId || 'job_default';
        const jobDir = path.join(UPLOADS_DIR, jobId);
        if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
        cb(null, jobDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// 5. SERVIR ARQUIVOS ESTÁTICOS
app.use(express.static(DIST_DIR));
app.use('/videos', express.static(OUTPUT_DIR));

// 6. ROTA DE RENDERIZAÇÃO (A MÁGICA DO BACKEND)
app.post('/api/render-job', upload.any(), async (req, res) => {
    const { jobId, scriptJson } = req.body;
    const jobDir = path.join(UPLOADS_DIR, jobId);
    
    console.log(`[Job ${jobId}] 🎬 Iniciando Renderização no Servidor...`);

    try {
        const script = JSON.parse(scriptJson);
        const imagesCount = script.scenes.length;
        const outputFileName = `viralize_${jobId}_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFileName);
        const listPath = path.join(jobDir, 'input_list.txt');
        const audioPath = path.join(jobDir, 'audio.wav');

        // A. Validar Arquivos
        if (!fs.existsSync(audioPath)) throw new Error("Áudio mestre não recebido.");

        // B. Criar Lista de Concatenação para FFmpeg
        // Formato: file 'caminho' \n duration X
        let listContent = '';
        for (let i = 0; i < imagesCount; i++) {
            const imgPath = path.join(jobDir, `frame_${i}.jpg`);
            if (!fs.existsSync(imgPath)) throw new Error(`Frame ${i} faltando.`);
            
            listContent += `file '${imgPath}'\n`;
            listContent += `duration ${script.scenes[i].duration}\n`;
        }
        // Repetir último frame para evitar corte brusco
        listContent += `file '${path.join(jobDir, `frame_${imagesCount-1}.jpg`)}'\n`;
        
        fs.writeFileSync(listPath, listContent);

        // C. EXECUTAR FFMPEG (MIXAGEM REAL)
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(listPath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .input(audioPath)
                .outputOptions([
                    '-map 0:v',           // Usar vídeo das imagens
                    '-map 1:a',           // Usar áudio do arquivo WAV
                    '-c:v libx264',       // Codec de vídeo H.264 (Universal)
                    '-pix_fmt yuv420p',   // Formato de pixel compatível
                    '-vf scale=1080:1920',// Garantir resolução HD Vertical
                    '-c:a aac',           // Codec de áudio AAC
                    '-b:a 192k',          // Qualidade de áudio
                    '-ac 2',              // Estéreo (Fix para mobile)
                    '-shortest',          // Cortar vídeo quando áudio acabar
                    '-r 30'               // 30 FPS
                ])
                .save(outputPath)
                .on('start', (cmd) => console.log(`[FFmpeg] Comando: ${cmd}`))
                .on('end', () => {
                    console.log(`[Job ${jobId}] ✅ Sucesso!`);
                    resolve();
                })
                .on('error', (err) => {
                    console.error(`[Job ${jobId}] ❌ Erro FFmpeg:`, err);
                    reject(err);
                });
        });

        // D. Limpeza e Retorno
        // (Opcional: Remover pasta temporária do job)
        // fs.rmSync(jobDir, { recursive: true, force: true });

        res.json({ 
            success: true, 
            url: `/videos/${outputFileName}`,
            message: "Vídeo renderizado com sucesso."
        });

    } catch (error) {
        console.error(`[Job ${jobId}] Falha Geral:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fallback para React Router
app.get('*', (req, res) => {
    const index = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else res.send("Aguardando Build do Frontend...");
});

app.listen(PORT, () => {
    console.log(`🚀 SERVIDOR RODANDO NA PORTA ${PORT}`);
    console.log(`📂 Working Dir: ${process.cwd()}`);
});
