<script lang="ts">
  import { onMount } from 'svelte';
  let time = new Date();
  let noteContent = '';
  let isRecording = false;
  let notes: { createdAt: string; note: string }[] = [];
  let textareaElement: HTMLTextAreaElement;

  const format = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format;
  const formatDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format;

  function toggleRecording() {
    isRecording = !isRecording;
  }

  function adjustTextareaHeight() {
    if (textareaElement) {
      textareaElement.style.height = '0';
      textareaElement.style.height = textareaElement.scrollHeight + 'px';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      if (!event.shiftKey) {
        event.preventDefault();
        const newNote = {
          createdAt: new Date().toISOString(),
          note: noteContent.trim()
        };
        
        if (newNote.note) {
          notes = [newNote, ...notes];
          localStorage.setItem('notes', JSON.stringify(notes));
          noteContent = '';
          adjustTextareaHeight();
        }
      } else {
        // After Shift+Enter is pressed, adjust height on next tick
        setTimeout(adjustTextareaHeight, 0);
      }
    }
  }

  function groupNotesByDay(notes: { createdAt: string; note: string }[]) {
    const groups = new Map<string, typeof notes>();
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    notes.forEach(note => {
      const date = new Date(note.createdAt);
      const dateString = date.toDateString();
      
      // Use special labels for today and yesterday
      let groupKey = dateString;
      if (dateString === today) {
        groupKey = 'Today';
      } else if (dateString === yesterday) {
        groupKey = 'Yesterday';
      } else {
        groupKey = formatDate(date);
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)?.push(note);
    });

    // Convert to array and sort by date (most recent first)
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === 'Today') return -1;
      if (b[0] === 'Today') return 1;
      if (a[0] === 'Yesterday') return -1;
      if (b[0] === 'Yesterday') return 1;
      return new Date(b[1][0].createdAt).getTime() - new Date(a[1][0].createdAt).getTime();
    });
  }

  onMount(() => {
    const savedNotes = localStorage.getItem('notes');
    if (savedNotes) {
      notes = JSON.parse(savedNotes);
    }
    const update = setInterval(() => {
      time = new Date();
    }, 1000);
    return () => clearInterval(update);
  });

  $: groupedNotes = groupNotesByDay(notes);
</script>

<div class="max-w-2xl mx-auto p-4 mt-8">
  <h1 class="text-2xl font-semibold text-gray-800 mb-8">Take a Note (+Whisper)</h1>
  <div class="flex gap-4 items-start mb-8 border-b border-gray-200 pt-2">
    <div class="flex flex-col h-6 justify-center">
      <time class="text-sm text-gray-500">
        {format(time)}
      </time>
    </div>
    <textarea
      bind:value={noteContent} 
      bind:this={textareaElement}
      rows={1}
      placeholder="Start writing... (Press Enter to save, Shift+Enter for new line)"
      on:keydown={handleKeydown}
      on:input={adjustTextareaHeight}
      class="flex-1 bg-white text-gray-800 text-base resize-none focus:outline-none focus:ring-0 overflow-hidden"
    ></textarea>
    <button 
      class="w-8 h-8 mt-[-4px] cursor-pointer px-1 flex items-center justify-center rounded-full hover:bg-gray-50 focus:outline-none focus:text-gray-600 focus:border-gray-400 transition-all duration-200 {isRecording ? 'border-red-500 text-white animate-pulse border' : 'border border-transparent bg-white text-gray-600'}"
      on:click={toggleRecording}
      aria-label="Toggle voice recording"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </button>
  </div>

  <div class="space-y-6">
    {#each groupedNotes as [date, dayNotes]}
      <div class="space-y-1">
        <h2 class="text-sm font-medium text-gray-600 pb-2 border-b border-gray-200">{date}</h2>
        {#each dayNotes as note}
          <div class="py-2 flex flex-row items-start space-x-4">
            <time class="text-sm text-gray-500 py-1">
              {format(new Date(note.createdAt))}
            </time>
            <p class="text-gray-900 whitespace-pre-wrap text-sm py-1">
              {note.note}
            </p>
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>
