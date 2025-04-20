import { writable } from 'svelte/store';

// Determine the server URL dynamically based on the environment
const SERVER_URL =
  typeof window !== 'undefined'
    ? window.location.hostname === 'localhost'
      ? 'ws://localhost:3000'
      : `ws://${window.location.host}`
    : 'ws://localhost:3000';

// WebSocket connection
export let socket: WebSocket | null = null;

// Create stores for transcription and notes
export const currentTranscription = writable('');
export const isFinalTranscription = writable(false);
export const notes = writable<{ id: string; text: string; timestamp: Date }[]>([]);

// Connection status callback
let connectionStatusCallback: ((status: string) => void) | null = null;
// Transcription callback
let transcriptionCallback: ((text: string) => void) | null = null;

// Initialize socket event listeners
export function initializeSocket(
  onStatusChange: (status: string) => void,
  onTranscription: (text: string) => void
) {
  // Save callbacks
  connectionStatusCallback = onStatusChange;
  transcriptionCallback = onTranscription;

  try {
    // Create new WebSocket connection
    socket = new WebSocket(SERVER_URL);

    // Setup event handlers
    socket.onopen = () => {
      console.log('WebSocket connected');
      if (connectionStatusCallback) connectionStatusCallback('Connected');
    };

    socket.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      if (connectionStatusCallback) connectionStatusCallback('Disconnected');

      // Try to reconnect after 3 seconds
      setTimeout(() => {
        if (socket?.readyState !== WebSocket.OPEN) {
          initializeSocket(onStatusChange, onTranscription);
        }
      }, 3000);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (connectionStatusCallback) connectionStatusCallback('Error');
    };

    socket.onmessage = (event) => {
      const transcription = event.data;
      console.log('Received transcription:', transcription);

      // Update transcription through callback
      if (transcriptionCallback) transcriptionCallback(transcription);

      // Update store
      currentTranscription.set(transcription);
      isFinalTranscription.set(true);

      // Reset final flag after a delay
      setTimeout(() => {
        isFinalTranscription.set(false);
      }, 2000);
    };
  } catch (error) {
    console.error('Failed to create WebSocket connection:', error);
    if (connectionStatusCallback) connectionStatusCallback('Connection Failed');
  }
}

// Function to emit voice stream data
export function sendVoiceData(audioData: Blob) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn('Cannot send audio: WebSocket not connected');
    return;
  }

  console.log('Sending audio data to server, size:', audioData.size);
  socket.send(audioData);
}

// Function to save a note
export function saveNote(text: string) {
  console.log('Saving note:', text);

  // Add the note to local store
  notes.update((currentNotes) => {
    const newNote = {
      id: Date.now().toString(),
      text,
      timestamp: new Date()
    };
    return [...currentNotes, newNote];
  });

  // Send to server via fetch API instead of WebSocket
  fetch('/api/notes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  }).catch((error) => {
    console.error('Error saving note:', error);
  });
}
