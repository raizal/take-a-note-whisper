import 'dotenv/config';
import { OpenAI } from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

// This is a simple script to test the Groq API integration
// To run: ts-node-dev --esm src/test-transcription.ts

// Initialize the OpenAI client with Groq API
const openai = new OpenAI({
  apiKey: config.groqApiKey,
  baseURL: 'https://api.groq.com/openai/v1',
});

async function testTranscription() {
  // Check if the API key is set
  if (config.groqApiKey === 'your_groq_api_key_here') {
    console.error('Error: Please set your Groq API key in the .env file');
    return;
  }

  try {
    console.log('Testing Groq API connection...');
    
    // Here you can replace this with an actual audio file path
    const testAudioFile = path.join(process.cwd(), 'test-audio.webm');
    
    // Check if the test file exists
    if (!fs.existsSync(testAudioFile)) {
      console.log('Test file not found. Please create a test-audio.webm file in the server directory.');
      console.log('This is just a test script to verify the Groq API integration.');
      return;
    }
    
    // Create a readable stream from the file
    const file = fs.createReadStream(testAudioFile);
    
    console.log('Sending request to Groq API...');
    const response = await openai.audio.transcriptions.create({
      file,
      model: config.transcriptionModel,
    });
    
    console.log('Transcription successful!');
    console.log('Transcribed text:', response.text);
  } catch (error) {
    console.error('Error testing transcription:', error);
  }
}

testTranscription(); 