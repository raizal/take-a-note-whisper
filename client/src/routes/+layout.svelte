<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<div class="flex min-h-screen flex-col">
  <main class="flex-1">
    {@render children()}
  </main>

  <footer class="sticky bottom-0 border-t border-gray-200 bg-gray-50 px-6 py-4">
    <div class="mx-auto max-w-3xl text-center text-sm text-gray-500">
      Created with ❤️ by <a
        href="https://raizal.dev"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium text-gray-700">Raizal I.N. Pregnanta</a
      >
    </div>
  </footer>
</div>
