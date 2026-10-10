import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const GEMINI_MODEL = 'gemini-3.8-flash';

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/api/chat', async (req, res) => {
  const { conversation, systemInstruction } = req.body ?? {};

  if (!Array.isArray(conversation) || conversation.length === 0) {
    return res.status(400).json({
      error: '`conversation` harus berupa array pesan yang tidak kosong.',
    });
  }

  const contents = [];
  for (const message of conversation) {
    const role = message?.role;
    const text = message?.text ?? message?.content;

    if (!['user', 'assistant', 'model'].includes(role) || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        error: 'Setiap pesan harus memiliki role user/assistant/model dan teks yang tidak kosong.',
      });
    }

    contents.push({
      role: role === 'assistant' ? 'model' : role,
      parts: [{ text }],
    });
  }

  if (systemInstruction !== undefined && typeof systemInstruction !== 'string') {
    return res.status(400).json({ error: '`systemInstruction` harus berupa teks.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Konfigurasi GEMINI_API_KEY belum tersedia.' });
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        temperature: 0.9,
        systemInstruction: systemInstruction?.trim() ||
          'Jawab hanya dalam bahasa Indonesia. Berikan jawaban singkat, jelas, sopan, dan langsung ke inti pertanyaan.',
      },
    });

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