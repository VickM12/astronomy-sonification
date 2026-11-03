class HarmoniaRecorder extends AudioWorkletProcessor {
  recording = false;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data === 'start') {
        this.recording = true;
      } else if (event.data === 'stop') {
        this.recording = false;
        this.port.postMessage('stopped');
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) {
      return true;
    }
    for (let channel = 0; channel < output.length; channel += 1) {
      output[channel].set(input[channel] ?? input[0] ?? new Float32Array(128));
    }
    if (this.recording && input[0]) {
      const left = new Float32Array(input[0]);
      const right = new Float32Array(input[1] ?? input[0]);
      this.port.postMessage({ left, right }, [left.buffer, right.buffer]);
    }
    return true;
  }
}

registerProcessor('harmonia-recorder', HarmoniaRecorder);
