<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<div class="min-h-screen flex flex-col">
	<main class="flex-1">
		{@render children()}
	</main>

	<footer class="sticky bottom-0 py-4 px-6 bg-gray-50 border-t border-gray-200">
		<div class="max-w-3xl mx-auto text-center text-sm text-gray-500">
			Created with ❤️ by <a href="https://raizal.dev" target="_blank" rel="noopener noreferrer" class="font-medium text-gray-700">Raizal I.N. Pregnanta</a>
		</div>
	</footer>
</div>
