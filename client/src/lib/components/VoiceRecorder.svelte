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

<div class="w-full max-w-[600px] mx-auto my-8 p-6 rounded-lg bg-gray-50 shadow-md">
  <div class="flex flex-col items-center gap-2 mb-4">
    {#if !isRecording}
      <button 
        on:click={startRecording} 
        class="px-6 py-3 rounded-md font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors duration-200"
      >
        Start Recording
      </button>
    {:else}
      <button 
        on:click={stopRecording} 
        class="px-6 py-3 rounded-md font-semibold bg-gray-500 text-white hover:bg-gray-600 transition-colors duration-200"
      >
        Stop Recording
      </button>
    {/if}
    <div class="text-xs text-gray-500">
      Socket: {connectionStatus}
    </div>
  </div>
  
  <div class="mt-6">
    {#if isRecording || $currentTranscription}
      <div class="p-4 bg-white rounded-md min-h-[100px] break-words whitespace-pre-wrap transition-colors duration-300 border {isRecording ? 'border-red-500' : ''} {$isFinalTranscription ? 'bg-green-50 border-green-500' : 'border-gray-200'}">
        {$currentTranscription || 'Listening...'}
      </div>
      <div class="flex items-center gap-2 mt-2 text-sm text-gray-500">
        {#if isRecording}
          <span class="inline-block w-3 h-3 rounded-full bg-red-500 animate-[ping_1.5s_ease-in-out_infinite]"></span>
          Recording
        {:else if $isFinalTranscription}
          <span>Saving note...</span>
        {/if}
      </div>
    {/if}
  </div>
</div>