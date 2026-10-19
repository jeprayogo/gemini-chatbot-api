import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import fs from 'fs';

const app = express();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_FALLBACK_MODEL = 'gemini-3.6-flash';
const MAX_TOTAL_FILE_SIZE = 18 * 1024 * 1024;
const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'audio/aac',
  'audio/flac',
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'application/pdf',
  'text/plain',
  'text/csv',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TOTAL_FILE_SIZE, files: 5 },
});

let unicornKnowledgeBase = '';
try {
    unicornKnowledgeBase = fs.readFileSync('unicorn_indorent_website_info.md', 'utf-8');
    console.log('Knowledge base loaded successfully.');
} catch (error) {
    console.warn('Error loading knowledge base:', error);
    unicornKnowledgeBase = 'Anda adala customer service Unicorn Indorent berdasarkan knowledge dari website https://unicorn.indorent.co.id, Jawab hanya dalam bahasa Indonesia. Berikan jawaban singkat, jelas, sopan, dan langsung ke inti pertanyaan.';
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));

const parseChatUploads = (req, res, next) => {
  upload.array('files', 5)(req, res, (error) => {
    if (!error) return next();

    const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 413
      : 400;
    return res.status(status).json({ error: error.message });
  });
};

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/api/chat', parseChatUploads, async (req, res) => {
  const { systemInstruction } = req.body ?? {};
  let { conversation } = req.body ?? {};
  const files = req.files ?? [];

  if (typeof conversation === 'string') {
    try {
      conversation = JSON.parse(conversation);
    } catch {
      return res.status(400).json({ error: '`conversation` harus berisi JSON yang valid.' });
    }
  }

  if (!Array.isArray(conversation) || conversation.length === 0) {
    return res.status(400).json({
      error: '`conversation` harus berupa array pesan yang tidak kosong.',
    });
  }

  const contents = [];
  let lastUserMessageIndex = -1;
  for (const [index, message] of conversation.entries()) {
    const role = message?.role;
    const text = message?.text ?? message?.content;
    const hasText = typeof text === 'string' && text.trim().length > 0;
    const canBeEmpty = files.length > 0 && role === 'user' && index === conversation.length - 1;

    if (!['user', 'assistant', 'model'].includes(role) || (!hasText && !canBeEmpty)) {
      return res.status(400).json({
        error: 'Setiap pesan harus memiliki role user/assistant/model dan teks yang tidak kosong, kecuali pesan user terakhir dengan file.',
      });
    }

    if (role === 'user') lastUserMessageIndex = index;
    contents.push({
      role: role === 'assistant' ? 'model' : role,
      parts: hasText ? [{ text }] : [],
    });
  }

  if (files.length > 0) {
    if (lastUserMessageIndex !== conversation.length - 1) {
      return res.status(400).json({
        error: 'Pesan terakhir pada `conversation` harus berasal dari user jika mengirim file.',
      });
    }

    const totalFileSize = files.reduce((total, file) => total + file.size, 0);
    if (totalFileSize > MAX_TOTAL_FILE_SIZE) {
      return res.status(413).json({ error: 'Ukuran total file maksimal 18 MB.' });
    }

    const unsupportedFile = files.find((file) => !supportedMimeTypes.has(file.mimetype));
    if (unsupportedFile) {
      return res.status(415).json({
        error: `Tipe file "${unsupportedFile.mimetype}" tidak didukung. Gunakan gambar, audio, PDF, TXT, atau CSV.`,
      });
    }

    contents[lastUserMessageIndex].parts.push(
      ...files.map((file) => ({
        inlineData: {
          mimeType: ['audio/x-wav', 'text/csv'].includes(file.mimetype)
            ? (file.mimetype === 'text/csv' ? 'text/plain' : 'audio/wav')
            : file.mimetype,
          data: file.buffer.toString('base64'),
        },
      })),
    );
  }

  if (systemInstruction !== undefined && typeof systemInstruction !== 'string') {
    return res.status(400).json({ error: '`systemInstruction` harus berupa teks.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Konfigurasi GEMINI_API_KEY belum tersedia.' });
  }

  try {
    const finalSystemInstruction = systemInstruction?.trim() 
      ? `${unicornKnowledgeBase}\n\n---\nINSTRUKSI TAMBAHAN (OVERRIDE):\n${systemInstruction.trim()}`
      : unicornKnowledgeBase;

    const request = {
      model: GEMINI_MODEL,
      contents,
      config: {
        temperature: 0.1,
        systemInstruction: finalSystemInstruction,
      },
    };

    let response;
    try {
      response = await ai.models.generateContent(request);
    } catch (error) {
      if (
        GEMINI_MODEL !== 'gemini-3.8-flash'
        || !(error instanceof Error)
        || error.status !== 503
      ) {
        throw error;
      }

      console.warn(
        `Model ${GEMINI_MODEL} sedang tidak tersedia (503); mencoba ${GEMINI_FALLBACK_MODEL}.`,
      );
      response = await ai.models.generateContent({
        ...request,
        model: GEMINI_FALLBACK_MODEL,
      });
    }

    return res.status(200).json({ response: response.text });
  } catch (error) {
    console.error('Gagal menghasilkan respons chatbot:', error);
    return res.status(502).json({ error: 'Gagal mendapatkan respons dari layanan AI.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});