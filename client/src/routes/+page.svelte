<script lang="ts">
  import { onMount } from 'svelte';
  import { PUBLIC_SERVER_URL } from '$env/static/public';

  const SERVER_URL = PUBLIC_SERVER_URL;

  let time = new Date();
  let noteContent = '';
  let isRecording = false;
  type Note = { createdAt: string; note: string };
  let notes: Note[] = [];
  let textareaElement: HTMLTextAreaElement;
  let selectedLang: string | null = null;

  const languages = [
    { code: 'id', name: 'Indonesia' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'zh', name: '中文' }
  ];

  // Load saved language preference
  onMount(() => {
    const savedLang = localStorage.getItem('preferredLanguage');
    console.log('Saved language:', savedLang);
    if (savedLang && languages.some((lang) => lang.code === savedLang)) {
      selectedLang = savedLang;
    } else {
      selectedLang = 'en';
    }

    const savedNotes = localStorage.getItem('notes');
    if (savedNotes) {
      notes = JSON.parse(savedNotes);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        toggleRecording();
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        e.preventDefault();
        if (isRecording) {
          stopRecording(false);
          setTimeout(startRecording, 250);
        } else {
          noteContent = '';
          adjustTextareaHeight();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const update = setInterval(() => {
      time = new Date();
    }, 1000);
    return () => {
      clearInterval(update);
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  // Save language preference when changed
  $: {
    if (typeof window !== 'undefined' && selectedLang) {
      localStorage.setItem('preferredLanguage', selectedLang);
      console.log('Saved language:', selectedLang);
    }
  }

  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let ws: WebSocket | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let volume = 0;

  const format = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format;
  const formatDate = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format;

  function toggleRecording() {
    if (isRecording) {
      stopRecording();
      setTimeout(adjustTextareaHeight, 250);
    } else {
      startRecording();
    }
  }

  function adjustTextareaHeight() {
    if (textareaElement) {
      textareaElement.style.height = '0';
      textareaElement.style.height =
        textareaElement.scrollHeight + (textareaElement.value.length > 0 ? 18 : 0) + 'px';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      if (!event.shiftKey) {
        event.preventDefault();
        saveNote();
      } else {
        // After Shift+Enter is pressed, adjust height on next tick
        setTimeout(adjustTextareaHeight, 0);
      }
    }
  }

  function saveNote() {
    const newNote: Note = {
      createdAt: new Date().toISOString(),
      note: noteContent.trim()
    };

    if (newNote.note) {
      notes = [newNote, ...notes];
      localStorage.setItem('notes', JSON.stringify(notes));
      noteContent = '';
      setTimeout(adjustTextareaHeight, 100);
    }
  }

  function deleteNote(noteId: string) {
    notes = notes.filter((n) => n.createdAt !== noteId);
    localStorage.setItem('notes', JSON.stringify(notes));
  }

  function clearNotes() {
    notes = [];
    localStorage.removeItem('notes');
  }

  type GroupedNotes = Record<string, Note[]>;
  let groupedNotes: GroupedNotes;
  $: groupedNotes = groupNotesByDay(notes);

  function groupNotesByDay(notes: Note[]) {
    const groups = new Map<string, Note[]>();

    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    notes.forEach((note) => {
      const date = new Date(note.createdAt);
      const dateString = date.toDateString();
      const displayDate =
        dateString === today ? 'Today' : dateString === yesterday ? 'Yesterday' : formatDate(date);

      const group = groups.get(displayDate) || [];
      group.push(note);
      groups.set(displayDate, group);
    });

    // Convert Map to object for Svelte reactivity
    const groupedObj: GroupedNotes = {};
    Array.from(groups.entries()).forEach(([key, value]) => {
      groupedObj[key] = value;
    });

    return Object.entries(groupedObj)
      .sort((a, b) => {
        if (a[0] === 'Today') return -1;
        if (b[0] === 'Today') return 1;
        if (a[0] === 'Yesterday') return -1;
        if (b[0] === 'Yesterday') return 1;
        return new Date(b[1][0].createdAt).getTime() - new Date(a[1][0].createdAt).getTime();
      })
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as GroupedNotes);
  }

  function exportAsMarkdown() {
    const markdown = Object.entries(groupedNotes)
      .map(([day, dayNotes]) => {
        const formattedNotes = dayNotes
          .map((note) => `##### ${new Date(note.createdAt).toLocaleTimeString()}\n\n${note.note}\n`)
          .join('\n');
        return `#### ${day}\n\n${formattedNotes}`;
      })
      .join('\n\n');

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function startRecording() {
    isRecording = true;

    audioContext = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: { sampleRate?: number } }).webkitAudioContext)({
      sampleRate: 16000
    });
    await audioContext.audioWorklet.addModule('/pcm-processor.js');

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

    sourceNode.connect(workletNode);
    // Optionally connect to destination for monitoring
    // workletNode.connect(audioContext.destination);

    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
      ws?.send(
        JSON.stringify({
          type: 'init',
          lang: selectedLang
        })
      );
    };

    workletNode.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'volume') {
        volume = msg.rms;
      } else if (msg.type === 'audio') {
        if (ws && ws.readyState === WebSocket.OPEN) {
          // Send raw Int16 PCM as ArrayBuffer
          ws.send(msg.pcm);
        }
      }
    };

    ws.onmessage = (event) => {
      console.log('WebSocket message:', event.data);
      if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);
        if (data.type === 'transcription' && data?.text?.length > 0) {
          noteContent = data.text;
          adjustTextareaHeight();
        }
      }
    };
  }

  function stopRecording(save = true) {
    ws?.close();
    if (save && noteContent.trim().length > 0) {
      saveNote();
    } else {
      noteContent = '';
      adjustTextareaHeight();
    }
    isRecording = false;
    if (workletNode) {
      workletNode.port.close();
      workletNode.disconnect();
    }
    if (sourceNode) {
      sourceNode.disconnect();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (audioContext) {
      audioContext.close();
    }
    ws = null;
    audioContext = null;
    mediaStream = null;
    workletNode = null;
    sourceNode = null;
    volume = 0;
  }
</script>

<div class="mx-auto mt-8 max-w-2xl p-4">
  <div class="sticky top-0 flex flex-col bg-white">
    <div class="mb-8 sticky top-0">
      <div class="mb-5 flex items-center justify-between">
        <h1 class="text-2xl font-semibold text-gray-800">Take a Note (+Whisper)</h1>
        <div class="flex flex-row items-center gap-2">
          <!-- <select
            disabled={isRecording}
            bind:value={selectedLang}
            class="rounded-lg border focus:ring-0 border-gray-300 bg-white px-1 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            {#each languages as lang}
              <option value={lang.code}>{lang.name}</option>
            {/each}
          </select> -->
          <button
            on:click={exportAsMarkdown}
            class="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span class="hidden md:block">Export as Markdown</span>
          </button>
          <button
            on:click={clearNotes}
            class="flex cursor-pointer items-center gap-1 rounded-lg border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              ><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
            >
            <span class="hidden md:block">Clear All</span>
          </button>
        </div>
      </div>
      <div class="space-y-2.5">
        <p class="text-sm text-gray-500">
          Press <kbd class="rounded border border-gray-300 bg-gray-100 px-1 py-0.5">Ctrl</kbd> +
          <kbd class="rounded border border-gray-300 bg-gray-100 px-1 py-0.5">Shift</kbd>
          + <kbd class="rounded border border-gray-300 bg-gray-100 px-1 py-0.5">Space</kbd> to start &
          save the recording
        </p>
        <p class="text-sm text-gray-500">
          Press <kbd class="rounded border border-gray-300 bg-gray-100 px-1 py-0.5">Ctrl</kbd> +
          <kbd class="rounded border border-gray-300 bg-gray-100 px-1 py-0.5">Shift</kbd>
          + <kbd class="rounded border border-gray-300 bg-gray-100 px-1 py-0.5">C</kbd> to clear the input
        </p>
        <p class="text-sm text-gray-500">
          ✨ Your notes are automatically saved in your browser's local storage
        </p>
      </div>
    </div>
    <div class="mb-8 flex items-start gap-4 border-b border-gray-200 pt-2 overflox-y-auto">
      <div class="flex h-6 flex-col justify-center">
        <time class="text-sm text-gray-500">
          {format(time)}
        </time>
      </div>
      <textarea
        bind:value={noteContent}
        bind:this={textareaElement}
        rows={1}
        placeholder={isRecording
          ? 'Listening...'
          : 'Start writing... (Press Enter to save, Shift+Enter for new line)'}
        on:keydown={handleKeydown}
        on:input={adjustTextareaHeight}
        class="flex-1 resize-none overflow-hidden bg-white text-base text-gray-800 focus:ring-0 focus:outline-none"
      ></textarea>
      <div class="hidden flex-col items-center md:flex">
        <button
          class="mt-[-4px] flex h-8 w-8 cursor-pointer items-center justify-center rounded-full px-1 transition-all duration-200 hover:bg-gray-50 focus:text-gray-600 focus:outline-none {isRecording
            ? 'animate-pulse border border-red-500 text-red-500'
            : 'border border-transparent bg-white text-gray-600'}"
          on:click={toggleRecording}
          aria-label="Toggle voice recording"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-6 w-6"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        <div class="mt-0.5 mb-1 h-1 w-full overflow-hidden rounded bg-gray-200">
          <div
            class="h-full transition-all duration-100"
            style="
              width: {Math.min(volume * 300, 100)}%;
              background: linear-gradient(to right, #22c55e, #facc15, #ef4444);
            "
          ></div>
        </div>
      </div>
    </div>
  </div>

  <div class="space-y-6">
    {#each Object.entries(groupedNotes || {}) as [day, dayNotes] (day)}
      <div class="space-y-4">
        <h2 class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-700">{day}</h2>
        {#each dayNotes as note (note.createdAt)}
          <div class="group flex flex-row items-start space-x-4 py-2">
            <time class="py-1 text-sm text-gray-500">
              {format(new Date(note.createdAt))}
            </time>
            <p class="flex-1 py-1 text-sm whitespace-pre-wrap text-gray-900 break-all">
              {note.note}
            </p>
            <button
              aria-label="Delete note"
              class="invisible ml-2 flex items-center rounded-full p-1 text-gray-400 transition-all group-hover:visible hover:bg-red-100 hover:text-red-500"
              title="Delete note"
              on:click={() => deleteNote(note.createdAt)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                /></svg
              >
            </button>
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <div class="fixed bottom-12 left-0 right-0 z-10 flex flex-col items-center md:hidden">
    <button
      class="mb-6 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full px-1 transition-all duration-200
        hover:bg-gray-300 focus:text-gray-600 focus:outline-none {isRecording
        ? 'animate-pulse bg-white border border-red-500 text-red-500'
        : 'border-gray-300 bg-gray-200 text-gray-600'}"
      on:click={toggleRecording}
      aria-label="Toggle voice recording"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-8 w-8"
      >
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
    <div class="mt-0.5 mb-1 h-1 w-full overflow-hidden rounded bg-gray-200">
      <div
        class="h-full transition-all duration-100"
        style="
          width: {Math.min(volume * 300, 100)}%;
          background: linear-gradient(to right, #22c55e, #facc15, #ef4444);
        "
      ></div>
    </div>
  </div>
</div>
