import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openai } from './services/transcription.js';
import config from './config.js';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import * as tmp from "tmp";
import crypto from 'crypto';

// Create the Express app
const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

// Create HTTP server
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

// Create a dictionary to store audio data per client
const clients = new Map();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, '../../client/dist')));

// Serve the SPA for any other routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../../client/dist/index.html'));
});

// Periodically process audio data (every 2 seconds)
const TRANSCRIPTION_INTERVAL = 500; // 2 seconds

const BATCH_SIZE = 6;

const idleTimeoutMs = 750; // 0.75 second

// Remove empty or non-speech results with advanced filter
const fillerPhrases = [
  'okay.', 'thank you.', 'thanks.', 'hmm.', 'so.', 'uh.', 'yes.', 'no.', 'alright.', 'huh.', 'hmm', 'hmm..', 'right.', 'sure.', 'ok.', 'sure', 'alright', 'hmm..', 'hmm...'
];
const isFiller = (t: string) => {
  const normalized = t.trim().toLowerCase();
  return fillerPhrases.includes(normalized) || normalized.length < 4 || normalized.split(/\s+/).length < 2;
};

wss.on("connection", (ws) => {
  console.log("New WebSocket connection established");
  
  // Assign a unique ID to this client
  const clientId = crypto.randomBytes(32).toString('hex') + "_" + Date.now().toString();

  // Initialize client data structure
  clients.set(clientId, {
    chunks: [] as { data: Buffer, file: tmp.FileResult, pcm: boolean }[], // Store chunks with their temp files
    lastTranscriptionTime: 0,
    processingTimer: null,
    isProcessing: false,
    lang: 'en',
    mediaRecorder: null,
    lastChunkCount: 0, // Track number of chunks to detect new ones
    transcription: '',
    lastChunkReceived: Date.now(), // Track last chunk arrival
  });
  
  const clientData = clients.get(clientId);
  
  // on connect, create interval transcription
  clientData.processingTimer = setInterval(async () => {
    const currentChunks = clientData.chunks.length;
    const newChunkCount = currentChunks - clientData.lastChunkCount;
    const hasEnoughNewChunks = newChunkCount >= BATCH_SIZE;

    const now = Date.now();
    const idle = (now - clientData.lastChunkReceived) > idleTimeoutMs && newChunkCount > 0;

    console.log(`Checking chunks - Current: ${currentChunks}, Last processed: ${clientData.lastChunkCount}`);

    // Only process if we have at least 8 new chunks, or if idle and any new chunks, and not already processing
    if ((hasEnoughNewChunks || idle) && !clientData.isProcessing) {
      console.log(`Processing ${newChunkCount} new chunks (${hasEnoughNewChunks ? 'threshold met' : 'idle timeout'})`);
      await processAudioChunks(clientId, ws);
      // Move lastChunkCount forward only after successful processing
      clientData.lastChunkCount = currentChunks;
    }
  }, TRANSCRIPTION_INTERVAL);

  // on message, add to collection
  ws.on("message", async (message) => {
    if (typeof message === 'string') {
      try {
        const json = JSON.parse(message);
        if (json?.type === 'init' && json?.lang) {
          const clientData = clients.get(clientId);
          if (clientData) {
            clientData.lang = json.lang;
          }
        }
      } catch (e) {
        console.warn("Invalid JSON message received");
      }
      return;
    }

    try {
      // Detect if message is raw PCM (Buffer) or JSON
      let isPCM = false;
      if (message instanceof Buffer) {
        // Heuristic: raw PCM is usually much larger and not valid UTF-8/JSON
        // Try to parse as JSON, if fails, treat as PCM
        try {
          JSON.parse(message.toString());
        } catch (e) {
          isPCM = true;
        }
      }
      if (isPCM) {
        // Save raw PCM chunk
        const clientData = clients.get(clientId);
        if (!clientData) return;
        let buf: Buffer;
        if (Buffer.isBuffer(message)) {
          buf = message;
        } else if (Array.isArray(message) && message.every((m) => Buffer.isBuffer(m))) {
          buf = Buffer.concat(message as Buffer[]);
        } else if (message instanceof ArrayBuffer) {
          buf = Buffer.from(new Uint8Array(message));
        } else if (typeof message === 'string') {
          buf = Buffer.from(message);
        } else {
          throw new Error('Unsupported message type for binary chunk');
        }
        console.log('Received raw PCM chunk:', buf.length);
        // Save as .pcm file
        const chunkFile = tmp.fileSync({ postfix: '.pcm' });
        fs.writeFileSync(chunkFile.name, buf);
        clientData.chunks.push({ data: buf, file: chunkFile, pcm: true });
        clientData.lastChunkReceived = Date.now(); // Update last chunk arrival
        return;
      }
      // Original handling for JSON audio or webm
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'audio') {
          const clientData = clients.get(clientId);
          if (!clientData) return;
          console.log('Received JSON audio chunk:', data.audio.length);
          // Save as .webm file for backward compatibility
          const chunkFile = tmp.fileSync({ postfix: '.webm' });
          const audioData = Buffer.from(data.audio, 'base64');
          fs.writeFileSync(chunkFile.name, audioData);
          clientData.chunks.push({ data: audioData, file: chunkFile, pcm: false });
          clientData.lastChunkReceived = Date.now(); // Update last chunk arrival
        }
      } catch (e) {
        // Fallback, treat as unknown binary
        const clientData = clients.get(clientId);
        if (!clientData) return;
        let buf: Buffer;
        if (Buffer.isBuffer(message)) {
          buf = message;
        } else if (Array.isArray(message) && message.every((m) => Buffer.isBuffer(m))) {
          buf = Buffer.concat(message as Buffer[]);
        } else if (message instanceof ArrayBuffer) {
          buf = Buffer.from(new Uint8Array(message));
        } else if (typeof message === 'string') {
          buf = Buffer.from(message);
        } else {
          throw new Error('Unsupported message type for binary chunk');
        }
        console.log('Received unknown binary chunk:', buf.length);
        const chunkFile = tmp.fileSync({ postfix: '.bin' });
        fs.writeFileSync(chunkFile.name, buf);
        clientData.chunks.push({ data: buf, file: chunkFile, pcm: false });
        clientData.lastChunkReceived = Date.now(); // Update last chunk arrival
      }
    } catch (e) {
      console.error("Error handling WebSocket message:", e);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    // Clean up client resources
    const clientData = clients.get(clientId);
    if (clientData) {
      if (clientData.processingTimer) {
        clearInterval(clientData.processingTimer);
      }
      // Clean up all chunk files
      for (const chunk of clientData.chunks) {
        if (chunk.file && typeof chunk.file.removeCallback === 'function') {
          try {
            chunk.file.removeCallback();
          } catch (e) {
            console.warn('Failed to remove temp file:', e);
          }
        }
      }
      clientData.chunks = [];
      clientData.transcription = '';
      clients.delete(clientId);
    }
  });
});

// Process accumulated audio chunks and attempt transcription
async function processAudioChunks(clientId: string, ws: any) {
  const clientData = clients.get(clientId);
  if (!clientData) return;
  
  clientData.isProcessing = true;
  console.log('Starting chunk processing...');
  
  try {
    // Process in batches of 8 chunks
    const unprocessedChunks = clientData.chunks.slice(clientData.lastChunkCount);
    const results: (string | null)[] = [];
    for (let batchStart = 0; batchStart < unprocessedChunks.length; batchStart += BATCH_SIZE) {
      const batch = unprocessedChunks.slice(batchStart, batchStart + BATCH_SIZE);
      // Merge all chunk buffers in order
      const mergedBuffer = Buffer.concat(batch.map(chunk => chunk.data));
      // Write merged buffer to a temp file
      const mergedFile = tmp.fileSync({ postfix: batch[0].pcm ? '.pcm' : '.webm' });
      fs.writeFileSync(mergedFile.name, mergedBuffer);
      const wavFile = tmp.fileSync({ postfix: '.wav' });
      console.log(`Converting merged batch ${batchStart / BATCH_SIZE + 1} to WAV`);
      try {
        if (batch[0].pcm) {
          // Use ffmpeg to convert raw PCM to WAV
          await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
              '-y',
              '-f', 's16le',        // PCM format: signed 16-bit little endian
              '-ar', '16000',       // Sample rate (match your PCM rate)
              '-ac', '1',           // Mono audio
              '-i', mergedFile.name,
              wavFile.name
            ]);
            let ffmpegError = '';
            ffmpeg.stderr.on('data', (data) => {
              ffmpegError += data.toString();
            });
            ffmpeg.on('close', (code) => {
              if (code === 0) {
                resolve(null);
              } else {
                reject(new Error(`FFmpeg PCM->WAV conversion failed with code ${code}: ${ffmpegError}`));
              }
            });
            ffmpeg.on('error', (err) => {
              reject(err);
            });
          });
        } else {
          await convertOpusToWav(mergedFile.name, wavFile.name);
        }
        console.log(`Wav file: ${wavFile.name}`);
        console.log(`Transcribing merged batch ${batchStart / BATCH_SIZE + 1}`);
        const text = await transcribeAudio(wavFile.name, clientData.lang);
        console.log(`Transcription batch ${batchStart / BATCH_SIZE + 1} result: ${text}`);

        if (text && text.trim().length > 0 && text.trim() !== '.' && !isFiller(text)) {
          results.push(text);
        } else {
          console.log(`Batch ${batchStart / BATCH_SIZE + 1} contains no speech or is not meaningful/filler, skipping.`);
          // If the last transcription does not end with a terminal punctuation, add a period
          if (clientData.transcription && !/[.!?]\s*$/.test(clientData.transcription.trim())) {
            clientData.transcription = clientData.transcription.trim() + '.';
          }
        }
      } catch (err) {
        console.error(`Error processing merged batch ${batchStart / BATCH_SIZE + 1}:`, err);
        results.push(null);
      } finally {
        // Clean up temp files
        mergedFile.removeCallback();
        wavFile.removeCallback();
      }
    }
    // Merge with previous transcription
    if (!clientData.transcription) clientData.transcription = '';
    const filteredResults = results.filter(text => text !== null && text !== undefined);
    if (filteredResults.length > 0) {
      const mergedTranscription = filteredResults.join(' ');
      clientData.transcription = (clientData.transcription + ' ' + mergedTranscription).trim();
    }
    // Send the updated transcription to the client
    if (clientData.transcription) {
      ws.send(JSON.stringify({ type: 'transcription', text: clientData.transcription }));
    }
    
  } catch (error) {
    console.error('Error processing audio chunks:', error);
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
  } finally {
    clientData.isProcessing = false;
    clientData.lastTranscriptionTime = Date.now();
    console.log('Chunk processing complete');
  }
}

// Function to transcribe audio using Whisper API
async function transcribeAudio(audioFile: string, language: string = 'en'): Promise<string | null> {
  if (!openai) {
    console.warn('No OpenAI client available');
    return null;
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFile),
      model: "whisper-large-v3",
      language: language,
    });

    return transcription.text;
  } catch (error) {
    console.error('Transcription API error:', error);
    return null;
  }
}

// Function to convert WebM (Opus) to WAV format
async function convertOpusToWav(webmFile: string, outputFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Direct conversion from WebM/Opus to WAV using FFmpeg
      const ffmpeg = spawn('ffmpeg', [
        '-y',                    // Overwrite output files
        '-i', webmFile,         // Input WebM file
        '-acodec', 'pcm_s16le', // Convert to 16-bit PCM
        '-ar', '16000',         // Sample rate for Whisper
        '-ac', '1',             // Mono audio
        outputFile              // Output WAV file
      ]);

      let ffmpegError = '';
      
      ffmpeg.stderr.on('data', (data) => {
        ffmpegError += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg conversion failed with code ${code}: ${ffmpegError}`));
        }
      });
      
      ffmpeg.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Start the server
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Groq API Key status: ${config.groqApiKey === 'your_groq_api_key_here' ? 'NOT SET' : 'Set'}`);
}); 