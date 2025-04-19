<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { sendVoiceData, currentTranscription, isFinalTranscription, saveNote, initializeSocket } from '$lib/socket';
  
  let isRecording = false;
  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceDetectionMs = 3000; // 3 seconds of silence to stop recording
  let connectionStatus = 'Not connected';
  let processingChunks = false;
  
  // Silence detection variables
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let silenceDetector: ReturnType<typeof setInterval> | null = null;
  let lastSound = Date.now();
  
  onMount(() => {
    console.log("VoiceRecorder mounted");
    // Initialize connection
    initializeSocket(
      (status: string) => {
        connectionStatus = status;
      }, 
      (transcription: string) => {
        currentTranscription.set(transcription);
      }
    );
  });
  
  // Function to detect silence
  function setupSilenceDetection() {
    if (!stream || !audioContext) return;
    
    // Create analyzer
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    
    // Connect the stream to the analyzer
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Check for silence every 500ms
    lastSound = Date.now();
    silenceDetector = setInterval(() => {
      if (!analyser) return;
      
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      if (average > 10) { // Threshold for sound detection
        lastSound = Date.now();
      } else {
        const silentTime = Date.now() - lastSound;
        if (silentTime > silenceDetectionMs && isRecording) {
          console.log(`Silence detected for ${silentTime}ms - stopping recording`);
          stopRecording();
        }
      }
    }, 500);
  }
  
  // Function to start recording
  async function startRecording() {
    try {
      console.log('Starting recording...');
      
      // Get user media
      stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      console.log('Got audio stream');
      
      // Create audio context for silence detection
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      isRecording = true;
      
      // Create media recorder with appropriate options
      const options = { 
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 16000
      };
      
      try {
        mediaRecorder = new MediaRecorder(stream, options);
        console.log('MediaRecorder created with mime type:', options.mimeType);
      } catch (e) {
        console.warn('Failed to create MediaRecorder with these options, trying default');
        mediaRecorder = new MediaRecorder(stream);
      }
      
      // Reset the transcription
      currentTranscription.set('Listening...');
      
      // Setup data handling
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log('Data available, size:', event.data.size);
          // Send each chunk immediately to the server
          sendVoiceData(event.data);
        }
      };
      
      // Request data frequently (every 500ms)
      mediaRecorder.start(500);
      console.log('MediaRecorder started, data interval: 500ms');
      
      // Setup silence detection
      setupSilenceDetection();
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  }
  
  // Function to stop recording
  function stopRecording() {
    console.log('Stopping recording...');
    
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      
      // Clean up silence detection
      if (silenceDetector) {
        clearInterval(silenceDetector);
        silenceDetector = null;
      }
      
      // Stop all tracks in the stream
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
      
      // Close audio context
      if (audioContext) {
        audioContext.close();
        audioContext = null;
        analyser = null;
      }
      
      // Send end stream signal
      const endMessage = new Blob([new TextEncoder().encode('END_STREAM')]);
      sendVoiceData(endMessage);
      
      // Save note if there's content
      const transcriptionValue = $currentTranscription;
      if (transcriptionValue && transcriptionValue !== 'Listening...' && transcriptionValue.trim() !== '') {
        saveNote(transcriptionValue);
        console.log('Note saved:', transcriptionValue);
      }
    }
  }

  // Clean up resources on component destruction
  onDestroy(() => {
    if (mediaRecorder && isRecording) {
      stopRecording();
    }
    
    if (silenceDetector) {
      clearInterval(silenceDetector);
    }
  });
</script>

<div class="voice-recorder">
  <div class="controls">
    {#if !isRecording}
      <button on:click={startRecording} class="record-btn">
        Start Recording
      </button>
    {:else}
      <button on:click={stopRecording} class="stop-btn">
        Stop Recording
      </button>
    {/if}
    <div class="connection-status">
      Socket: {connectionStatus}
    </div>
  </div>
  
  <div class="transcription-container">
    {#if isRecording || $currentTranscription}
      <div class="transcription" class:final={$isFinalTranscription} class:recording={isRecording}>
        {$currentTranscription || 'Listening...'}
      </div>
      <div class="status">
        {#if isRecording}
          <span class="recording-indicator"></span> Recording
        {:else if $isFinalTranscription}
          <span>Saving note...</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .voice-recorder {
    width: 100%;
    max-width: 600px;
    margin: 2rem auto;
    padding: 1.5rem;
    border-radius: 0.5rem;
    background-color: #f9fafb;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }
  
  .controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 1rem;
    gap: 0.5rem;
  }
  
  .connection-status {
    font-size: 0.75rem;
    color: #6b7280;
  }
  
  button {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .record-btn {
    background-color: #ef4444;
    color: white;
  }
  
  .record-btn:hover {
    background-color: #dc2626;
  }
  
  .stop-btn {
    background-color: #6b7280;
    color: white;
  }
  
  .stop-btn:hover {
    background-color: #4b5563;
  }
  
  .transcription-container {
    margin-top: 1.5rem;
  }
  
  .transcription {
    padding: 1rem;
    background-color: white;
    border-radius: 0.375rem;
    min-height: 100px;
    border: 1px solid #e5e7eb;
    white-space: pre-wrap;
    word-break: break-word;
    transition: background-color 0.3s ease;
  }
  
  .transcription.final {
    background-color: #ecfdf5;
    border-color: #10b981;
  }
  
  .transcription.recording {
    border-color: #ef4444;
  }
  
  .status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: #6b7280;
  }
  
  .recording-indicator {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background-color: #ef4444;
    animation: pulse 1.5s infinite;
  }
  
  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
    100% {
      opacity: 1;
    }
  }
</style> 