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

// Create the Express app
const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));

// Create HTTP server
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

type Note = {
  id: string;
  text: string;
  timestamp: Date;
};

// Create a dictionary to store audio data per client
const clients = new Map();

// Store for notes
const notes: Note[] = [];

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, '../../client/dist')));

// API routes
app.get('/api/notes', (req: express.Request, res: express.Response) => {
  res.json(notes);
});

app.post('/api/notes', (req: express.Request, res: express.Response) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: 'Text is required' });
    return;
  }

  const newNote: Note = {
    id: Date.now().toString(),
    text,
    timestamp: new Date()
  };
  
  notes.push(newNote);
  res.status(201).json(newNote);
});

// Serve the SPA for any other routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../../client/dist/index.html'));
});

// Periodically process audio data (every 2 seconds)
const TRANSCRIPTION_INTERVAL = 500; // 2 seconds

wss.on("connection", (ws) => {
  console.log("New WebSocket connection established");
  
  // Assign a unique ID to this client
  const clientId = Date.now().toString();
  
  // Initialize client data structure
  clients.set(clientId, {
    // Use a single continuous buffer for the first chunk with header
    firstChunk: null,
    // Store subsequent chunks
    subsequentChunks: [],
    lastTranscriptionTime: 0,
    processingTimer: null,
    isProcessing: false
  });
  
  const clientData = clients.get(clientId);
  
  // Set up processing timer
  clientData.processingTimer = setInterval(async () => {
    const hasAudio = clientData.firstChunk !== null && 
                    (clientData.subsequentChunks.length > 0 || clientData.firstChunk.length > 1000);
    
    if (hasAudio && !clientData.isProcessing) {
      await processAudioChunks(clientId, ws);
    }
  }, TRANSCRIPTION_INTERVAL);

  ws.on("message", async (msg) => {
    if (!(msg instanceof Buffer)) {
      console.warn("Received non-buffer data, ignoring");
      return;
    }
    
    if (msg.length < 100) {
      // This might be a control message, not audio data
      try {
        const controlMsg = msg.toString();
        if (controlMsg === 'END_STREAM') {
          // Process any remaining audio when client signals end of stream
          const clientData = clients.get(clientId);
          if (clientData && clientData.firstChunk && !clientData.isProcessing) {
            await processAudioChunks(clientId, ws, true);
          }
          return;
        }
      } catch (e) {
        console.warn("Error processing potential control message:", e);
      }
    }
    
    // Add the new chunk to our collection
    const clientData = clients.get(clientId);
    
    // If this is the first chunk we've received, store it separately 
    // because it contains the WebM headers
    if (clientData.firstChunk === null) {
      clientData.firstChunk = msg;
      console.log(`Received first chunk with headers: ${msg.length} bytes`);
    } else {
      // For subsequent chunks, add to the collection
      clientData.subsequentChunks.push(msg);
      console.log(`Received chunk: ${msg.length} bytes, total chunks: ${clientData.subsequentChunks.length + 1}`);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    // Clean up client resources
    const clientData = clients.get(clientId);
    if (clientData && clientData.processingTimer) {
      clearInterval(clientData.processingTimer);
    }
    clients.delete(clientId);
  });
});

// Process accumulated audio chunks and attempt transcription
async function processAudioChunks(clientId: string, ws: any, isFinal = false) {
  const clientData = clients.get(clientId);
  if (!clientData || clientData.firstChunk === null) return;
  
  clientData.isProcessing = true;
  
  try {
    console.log(`Processing audio for client ${clientId} (${clientData.subsequentChunks.length + 1} chunks)`);
    
    // Create temporary files for audio data
    // const pcmFile = tmp.fileSync({ postfix: '.pcm' });
    const wavFile = tmp.fileSync({ postfix: '.wav' });
    
    // Use FFmpeg to decode WebM to PCM
    await decodeWebmToPcm(clientData.firstChunk, clientData.subsequentChunks, wavFile.name);
    
    // Convert PCM to WAV (FFmpeg requires WAV for the transcription API)
    // await convertPcmToWav(pcmFile.name, wavFile.name);

    // Transcribe the audio
    if (openai) {
      console.log('Sending audio to Groq API for transcription');
      
      try {
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(wavFile.name),
          model: "whisper-large-v3",
        });
        
        console.log('Transcription result:', transcription.text);
        
        // Send the transcription back to the client
        if (ws.readyState === 1) { // 1 = OPEN
          ws.send(transcription.text);
        }
      } catch (error) {
        console.error('Transcription API error:', error);
        if (ws.readyState === 1) {
          ws.send("Error during transcription");
        }
      }
    } else {
      console.log('No OpenAI client available, using fallback');
      if (ws.readyState === 1) {
        ws.send("No transcription service available");
      }
    }
  
    // Clean up temporary files
    // pcmFile.removeCallback();
    // wavFile.removeCallback();
    
    // If this is the final processing, clear all data
    // Otherwise, keep the first chunk (with headers) and recent audio for context
    if (isFinal) {
      clientData.firstChunk = null;
      clientData.subsequentChunks = [];
    } else {
      // Keep only last few chunks for context in next transcription
      // if (clientData.subsequentChunks.length > 8) { // About 4 seconds of audio
      //   clientData.subsequentChunks = clientData.subsequentChunks.slice(-8);
      // }
    }
    
  } catch (error) {
    console.error('Error processing audio chunks:', error);
  } finally {
    clientData.isProcessing = false;
    clientData.lastTranscriptionTime = Date.now();
  }
}

// Function to decode WebM to raw PCM audio using FFmpeg
async function decodeWebmToPcm(firstChunk: Buffer, subsequentChunks: Buffer[], outputFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Create temp file for combined WebM data
    const tempWebmFile = tmp.fileSync({ postfix: '.webm' });
    
    try {
      // Write firstChunk with headers
      fs.writeFileSync(tempWebmFile.name, firstChunk);
      
      // Append all subsequent chunks
      if (subsequentChunks.length > 0) {
        fs.appendFileSync(tempWebmFile.name, Buffer.concat(subsequentChunks));
      }
      
      // Spawn FFmpeg process to convert WebM to PCM
      const ffmpeg = spawn('ffmpeg', [
        '-y',                     // Overwrite output files
        '-i', tempWebmFile.name,  // Input file
        '-vn',                    // Disable video
        // '-acodec', 'pcm_s16le',   // PCM signed 16-bit little-endian
        '-ar', '16000',           // Audio sampling rate
        '-ac', '1',               // Audio channels (mono)
        // '-f', 's16le',            // Force output format
        outputFile                // Output file
      ]);
      
      let ffmpegError = '';
      
      ffmpeg.stderr.on('data', (data) => {
        // FFmpeg outputs progress info to stderr
        // We can ignore this or log it for debugging
        ffmpegError += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        tempWebmFile.removeCallback(); // Clean up temp file
        
        if (code === 0) {
          console.log('FFmpeg WebM to PCM conversion successful');
          resolve();
        } else {
          console.error('FFmpeg WebM to PCM conversion failed with code', code);
          console.error('FFmpeg error output:', ffmpegError);
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      
      ffmpeg.on('error', (err) => {
        tempWebmFile.removeCallback(); // Clean up temp file
        console.error('FFmpeg process error:', err);
        reject(err);
      });
    } catch (err) {
      tempWebmFile.removeCallback(); // Clean up temp file
      reject(err);
    }
  });
}

// Function to convert PCM to WAV format
async function convertPcmToWav(inputFile: string, outputFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Spawn FFmpeg process to convert PCM to WAV
    const ffmpeg = spawn('ffmpeg', [
      '-y',                 // Overwrite output files
      '-f', 's16le',        // Format of input file
      '-ar', '16000',       // Audio sampling rate
      '-ac', '1',           // Audio channels (mono)
      '-i', 'pipe:0',          // Input from stdin
      '-i', inputFile,      // Input file
      outputFile            // Output file
    ]);
    
    let ffmpegError = '';
    
    ffmpeg.stderr.on('data', (data) => {
      ffmpegError += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('FFmpeg PCM to WAV conversion successful');
        resolve();
      } else {
        console.error('FFmpeg PCM to WAV conversion failed with code', code);
        console.error('FFmpeg error output:', ffmpegError);
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
      console.error('FFmpeg process error:', err);
      reject(err);
    });
  });
}

// Start the server
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Groq API Key status: ${config.groqApiKey === 'your_groq_api_key_here' ? 'NOT SET' : 'Set'}`);
}); 