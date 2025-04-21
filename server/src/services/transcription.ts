import { OpenAI } from 'openai';
import config from '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

// Initialize the OpenAI client with Groq API if API key is available
export let openai: OpenAI | null = null;

if (config.groqApiKey && config.groqApiKey !== 'your_groq_api_key_here') {
  openai = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  console.log('Groq API client initialized');
} else {
  console.warn('No Groq API key found. Using fallback transcription.');
}

// Create temp directory for audio files if it doesn't exist
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, '../../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Save base64 audio data to a temporary file
 * @param audioData Base64 audio data
 * @returns Path to the saved file
 */
async function saveAudioToFile(audioData: string): Promise<string> {
  try {
    // Extract the actual base64 data (remove data:audio/webm;base64, prefix)
    const parts = audioData.split(',');
    const base64Data = parts.length > 1 ? parts[1] : parts[0];
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Create a unique filename based on timestamp
    const filename = `audio_${Date.now()}.webm`;
    const filePath = path.join(tempDir, filename);
    
    // Write the file
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (error) {
    console.error('Error saving audio file:', error);
    throw new Error('Failed to save audio file');
  }
}

/**
 * Fallback transcription when no Groq API key is available
 * @returns Mock transcription text
 */
function fallbackTranscription(): string {
  const mockResponses = [
    "This is a simulated transcription because no Groq API key was provided.",
    "Please add your Groq API key to the .env file to enable real transcription.",
    "Placeholder text for demo purposes. Your voice would be transcribed here.",
    "To use the real transcription service, you need to add a Groq API key.",
    "This is what transcribed text would look like if you had a Groq API key."
  ];
  
  // Return a random mock response
  return mockResponses[Math.floor(Math.random() * mockResponses.length)];
}

/**
 * Transcribe audio data using Groq API
 * @param audioData Base64 audio data
 * @returns Transcription text
 */
export async function transcribeAudio(audioData: string): Promise<string> {
  try {
    // If no Groq API key, use fallback
    if (!openai) {
      console.log('Using fallback transcription (no API key)');
      return fallbackTranscription();
    }
    
    // Save the audio to a temporary file
    const filePath = await saveAudioToFile(audioData);
    console.log('Audio saved to temporary file:', filePath);
    
    // Create a readable stream from the file
    const fileStream = fs.createReadStream(filePath);
    
    // Create a FormData-like object that the OpenAI API expects
    const file = {
      file: fileStream,
      filename: path.basename(filePath),
    };
    
    console.log('Sending request to Groq API...');
    // Use the OpenAI API for transcription
    const response = await openai.audio.transcriptions.create({
      file: file as any, // Type assertion to handle the expected FormData
      model: config.transcriptionModel,
      language: 'en',
    });
    
    // Clean up the temporary file
    fs.unlinkSync(filePath);
    console.log('Temporary file deleted');
    
    // Return the transcription text
    console.log('Transcription received from Groq API');
    return response.text;
  } catch (error) {
    console.error('Transcription error:', error);
    // If there's an error, return a placeholder message
    return 'Sorry, there was an error transcribing your audio.';
  }
} 