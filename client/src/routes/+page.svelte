<script lang="ts">
  import { onMount } from 'svelte';
  import VoiceRecorder from '$lib/components/VoiceRecorder.svelte';
  import NotesList from '$lib/components/NotesList.svelte';
  import { initializeSocket } from '$lib/socket';
  
  onMount(() => {
    initializeSocket();
  });
</script>

<main>
  <div class="container">
    <h1>Voice to Note</h1>
    <p class="description">
      Record your voice and it will be transcribed into notes in real-time.
      Recording will automatically stop after 1 second of silence.
    </p>
    
    <VoiceRecorder />
    <NotesList />
  </div>
</main>

<style>
  main {
    width: 100%;
    min-height: 100vh;
    padding: 2rem 1rem;
    background-color: #f3f4f6;
  }
  
  .container {
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
  }
  
  h1 {
    text-align: center;
    font-size: 2.5rem;
    color: #111827;
    margin-bottom: 0.5rem;
  }
  
  .description {
    text-align: center;
    color: #6b7280;
    margin-bottom: 2rem;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }
</style>
