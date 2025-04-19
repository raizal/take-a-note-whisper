<script lang="ts">
  import { notes } from '$lib/socket';
  
  // Function to format date for display
  function formatDate(date: Date): string {
    return new Date(date).toLocaleString();
  }
</script>

<div class="notes-list">
  <h2>Your Notes</h2>
  
  {#if $notes.length === 0}
    <div class="empty-state">
      <p>No notes yet. Start recording to create a note!</p>
    </div>
  {:else}
    <ul>
      {#each $notes as note (note.id)}
        <li>
          <div class="note-content">
            <p>{note.text}</p>
            <span class="note-date">{formatDate(note.timestamp)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .notes-list {
    width: 100%;
    max-width: 600px;
    margin: 2rem auto;
    padding: 1.5rem;
    border-radius: 0.5rem;
    background-color: #f9fafb;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }
  
  h2 {
    margin-top: 0;
    color: #111827;
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }
  
  .empty-state {
    text-align: center;
    padding: 2rem 0;
    color: #6b7280;
  }
  
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  
  li {
    margin-bottom: 1rem;
    padding: 1rem;
    background-color: white;
    border-radius: 0.375rem;
    border-left: 4px solid #3b82f6;
  }
  
  .note-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .note-content p {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  
  .note-date {
    font-size: 0.75rem;
    color: #6b7280;
    align-self: flex-end;
  }
</style> 