class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(48000); // Pre-allocate 1 second buffer
    this._writeIndex = 0;
    this._sampleRate = 16000;
    this._chunkSize = (this._sampleRate * 500) / 1000; // 500ms chunk
    this._lastSent = Date.now();
  }

  process(inputs) {
    const input = inputs[0];
    if (!input.length || !input[0].length) return true;

    const channelData = input[0];
    
    // Calculate RMS
    const rms = Math.sqrt(
      channelData.reduce((sum, val) => sum + val * val, 0) / channelData.length
    );
    const isSilent = rms < 0.01;

    // Volume update (more frequent)
    this.port.postMessage({
      type: 'volume',
      rms,
      isSilent,
      db: 20 * Math.log10(rms)
    });

    // Copy new data to buffer
    this._buffer.set(channelData, this._writeIndex);
    this._writeIndex += channelData.length;

    const now = Date.now();
    if (this._writeIndex >= this._chunkSize && now - this._lastSent >= 500) {
      // Convert and send chunk
      const pcm16 = this.floatTo16BitPCM(this._buffer.slice(0, this._chunkSize));
      
      // Move remaining data to start
      this._buffer.copyWithin(0, this._chunkSize);
      this._writeIndex -= this._chunkSize;
      this._lastSent = now;

      this.port.postMessage({
        type: 'audio',
        pcm: pcm16,
        isSilent,
        rms,
        db: 20 * Math.log10(rms)
      }, [pcm16]);
    }

    return true;
  }

  floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output.buffer;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
