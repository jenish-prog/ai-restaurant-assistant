/**
 * AudioStreamer: Manages bidirectional PCM streaming between browser and Gemini Live WebSocket.
 * - Captures microphone at the device NATIVE rate, downsamples to mono 16kHz
 *   16-bit linear PCM (what Gemini Live requires), batches ~150-200ms frames.
 * - Receives 24kHz 16-bit linear PCM from Gemini Live and plays it gaplessly.
 * - Handles interruptions cleanly by stopping queued audio nodes immediately.
 */

export const MIC_TARGET_RATE = 16000;

/** Pure helper (unit-testable): decimate float32 mono to 16kHz Int16 PCM. */
export function downsampleTo16k(input: Float32Array, nativeRate: number): Int16Array {
  if (nativeRate === MIC_TARGET_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = nativeRate / MIC_TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const avg = sum / Math.max(1, end - start);
    const s = Math.max(-1, Math.min(1, avg));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export class AudioStreamer {
  private audioContext: AudioContext | null = null;
  private recordContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private scheduledTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private onAudioChunk: (base64Pcm: string) => void;
  private onSpeakingStateChange?: (speaking: boolean) => void;
  private onMicError?: (message: string) => void;
  private isCapturing: boolean = false;
  // Batch audio into 20–40 ms frames (~640–1280 bytes at 16kHz 16-bit mono)
  // per Google's Gemini Live low-latency streaming recommendation.
  private micQueue: Uint8Array[] = [];
  private micQueuedBytes: number = 0;
  private micFlushBytes: number = 960; // ~30ms @ 16kHz 16-bit mono (30ms = 480 samples * 2 bytes)
  private micFlushTimer: number | null = null;
  private primed: boolean = false;
  private primeBytes: number = 640; // ~20ms: first byte out fast
  private nativeRate: number = MIC_TARGET_RATE;
  private chunksSent: number = 0;
  private bytesSent: number = 0;
  // Voice-input timing (performance.now ms, reset per recording).
  private recStartAt: number = 0;
  private firstFrameAt: number = 0;
  private firstFlushAt: number = 0;
  private lastFlushAt: number = 0;

  constructor(
    onAudioChunk: (base64Pcm: string) => void,
    onSpeakingStateChange?: (speaking: boolean) => void,
    onMicError?: (message: string) => void
  ) {
    this.onAudioChunk = onAudioChunk;
    this.onSpeakingStateChange = onSpeakingStateChange;
    this.onMicError = onMicError;
  }

  getNativeRate(): number {
    return this.nativeRate;
  }

  getMicStats(): { chunksSent: number; bytesSent: number; nativeRate: number; capturing: boolean } {
    return {
      chunksSent: this.chunksSent,
      bytesSent: this.bytesSent,
      nativeRate: this.nativeRate,
      capturing: this.isCapturing,
    };
  }

  /**
   * Initializes Web Audio context for 24kHz playback
   */
  private getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 24000 });
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  /**
   * Pre-creates/resumes the playback context on user gesture so the first
   * AI reply doesn't pay AudioContext startup cost (phone-call feel).
   */
  warmup(): void {
    try {
      this.getAudioContext();
    } catch {
      // ignore — will init lazily on first chunk
    }
  }

  /**
   * Clears stale playback schedule (e.g. new user turn while old audio still
   * queued) so the next answer starts immediately instead of late.
   */
  resetPlaybackSchedule(): void {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.scheduledTime = Math.max(this.scheduledTime, this.audioContext.currentTime);
      // If schedule drifted far into the future (network burst), pull it back.
      if (this.scheduledTime - this.audioContext.currentTime > 1.5) {
        this.scheduledTime = this.audioContext.currentTime;
      }
    }
  }

  /**
   * Queues raw mic bytes, flushing ~200ms frames to the server.
   * The very first frame of each recording is primed out early (~50ms of
   * audio) so Gemini gets its first byte fast; steady state is unchanged.
   */
  private queueMicBytes(data: ArrayBuffer): void {
    if (!this.isCapturing) return;
    if (!this.firstFrameAt) this.firstFrameAt = performance.now();
    const chunk = new Uint8Array(data.slice(0));
    this.micQueue.push(chunk);
    this.micQueuedBytes += chunk.byteLength;
    if (this.micQueuedBytes >= this.micFlushBytes) {
      this.flushMicQueue();
    } else if (!this.primed && this.micQueuedBytes >= this.primeBytes) {
      this.primed = true;
      this.flushMicQueue();
    }
  }

  /**
   * Per-recording capture timeline (all performance.now ms, 0 = not yet).
   * recStart: recording started; firstFrame: first mic quantum arrived;
   * firstFlush/lastFlush: first/last WS chunk sent.
   */
  getMicTimings(): { recStart: number; firstFrame: number; firstFlush: number; lastFlush: number } {
    return {
      recStart: this.recStartAt,
      firstFrame: this.firstFrameAt,
      firstFlush: this.firstFlushAt,
      lastFlush: this.lastFlushAt,
    };
  }

  private flushMicQueue(): void {
    if (this.micQueue.length === 0 || this.micQueuedBytes === 0) return;
    const combined = new Uint8Array(this.micQueuedBytes);
    let offset = 0;
    for (const q of this.micQueue) {
      combined.set(q, offset);
      offset += q.byteLength;
    }
    this.micQueue = [];
    this.micQueuedBytes = 0;
    let binary = '';
    // Chunked conversion avoids stack overflow on large frames.
    const CHUNK = 8192;
    for (let i = 0; i < combined.length; i += CHUNK) {
      binary += String.fromCharCode(...combined.subarray(i, i + CHUNK));
    }
    this.chunksSent += 1;
    this.bytesSent += combined.length;
    const now = performance.now();
    if (!this.firstFlushAt) this.firstFlushAt = now;
    this.lastFlushAt = now;
    this.onAudioChunk(btoa(binary));
  }

  private startMicFlushTimer(): void {
    this.stopMicFlushTimer();
    // Time-based flush: ship partial tails every 30ms so pauses don't cut
    // speech and Gemini receives low-latency streaming chunks continuously.
    this.micFlushTimer = window.setInterval(() => {
      if (this.isCapturing) this.flushMicQueue();
    }, 30);
  }

  private stopMicFlushTimer(): void {
    if (this.micFlushTimer !== null) {
      window.clearInterval(this.micFlushTimer);
      this.micFlushTimer = null;
    }
  }
  async startRecording(): Promise<void> {
    if (this.isCapturing) return;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Surface disconnected-device failures visibly instead of silent stall.
      for (const track of this.mediaStream.getAudioTracks()) {
        track.onended = () => {
          if (this.onMicError) this.onMicError('Microphone device disconnected. Please reconnect and press Start again.');
        };
      }

      // Capture at the device NATIVE rate, then downsample to 16kHz explicitly.
      // (Requesting {sampleRate:16000} is a hint browsers may ignore; the old
      // code assumed 16kHz and mislabeled 48kHz audio → garbage transcription.)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.recordContext = new AudioContextClass();
      if (this.recordContext.state === 'suspended') {
        await this.recordContext.resume().catch(() => {});
      }
      this.nativeRate = this.recordContext.sampleRate || 48000;
      this.inputSource = this.recordContext.createMediaStreamSource(this.mediaStream);
      this.isCapturing = true;
      // Reset per-recording voice timeline + first-byte prime.
      this.recStartAt = performance.now();
      this.firstFrameAt = 0;
      this.firstFlushAt = 0;
      this.lastFlushAt = 0;
      this.primed = false;
      this.startMicFlushTimer();

      // Attempt to use modern AudioWorklet first
      let workletInitialized = false;
      if (this.recordContext.audioWorklet) {
        try {
          const nativeRate = this.nativeRate;
          const workletBlob = new Blob(
            [
              `
              class PCMRecorderProcessor extends AudioWorkletProcessor {
                constructor() {
                  super();
                  this._carry = [];
                  this._ratio = ${nativeRate} / ${MIC_TARGET_RATE};
                }
                process(inputs) {
                  const input = inputs[0];
                  if (input && input[0]) {
                    const channelData = input[0];
                    if (this._ratio <= 1.01) {
                      const pcm16 = new Int16Array(channelData.length);
                      for (let i = 0; i < channelData.length; i++) {
                        const s = Math.max(-1, Math.min(1, channelData[i]));
                        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                      }
                      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
                    } else {
                      // Accumulate and decimate by averaging to true 16kHz.
                      for (let i = 0; i < channelData.length; i++) this._carry.push(channelData[i]);
                      const outLen = Math.floor(this._carry.length / this._ratio);
                      if (outLen > 0) {
                        const pcm16 = new Int16Array(outLen);
                        for (let i = 0; i < outLen; i++) {
                          const start = Math.floor(i * this._ratio);
                          const end = Math.min(this._carry.length, Math.floor((i + 1) * this._ratio));
                          let sum = 0;
                          for (let j = start; j < end; j++) sum += this._carry[j];
                          const avg = sum / Math.max(1, end - start);
                          const s = Math.max(-1, Math.min(1, avg));
                          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                        }
                        this._carry.splice(0, Math.floor(outLen * this._ratio));
                        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
                      }
                    }
                  }
                  return true;
                }
              }
              registerProcessor('pcm-recorder-processor', PCMRecorderProcessor);
              `,
            ],
            { type: 'application/javascript' }
          );

          const workletUrl = URL.createObjectURL(workletBlob);
          await this.recordContext.audioWorklet.addModule(workletUrl);
          URL.revokeObjectURL(workletUrl);

          this.workletNode = new AudioWorkletNode(this.recordContext, 'pcm-recorder-processor');
          // Batch into ~200ms frames instead of spamming per-quantum packets.
          this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
            this.queueMicBytes(event.data);
          };

          this.inputSource.connect(this.workletNode);
          this.workletNode.connect(this.recordContext.destination);
          workletInitialized = true;
        } catch (workletErr) {
          console.warn('AudioWorklet initialization fallback to ScriptProcessor:', workletErr);
        }
      }

      // Graceful fallback to ScriptProcessor if AudioWorklet unavailable
      if (!workletInitialized) {
        const bufferSize = 2048;
        const nativeRate = this.nativeRate;
        this.scriptProcessor = this.recordContext.createScriptProcessor(bufferSize, 1, 1);
        let carry: number[] = [];
        this.scriptProcessor.onaudioprocess = (event) => {
          if (!this.isCapturing) return;
          const inputData = event.inputBuffer.getChannelData(0);
          const down = downsampleTo16k(
            inputData instanceof Float32Array ? inputData : new Float32Array(inputData),
            nativeRate
          );
          // Keep carry logic simple: downsample helper already decimates.
          void carry;
          this.queueMicBytes(down.buffer as ArrayBuffer);
        };

        this.inputSource.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.recordContext.destination);
      }
    } catch (err: any) {
      this.isCapturing = false;
      this.stopMicFlushTimer();
      throw err;
    }
  }

  /**
   * Stops microphone capture and cleans up worklets and media tracks
   */
  stopRecording(): void {
    this.isCapturing = false;
    this.stopMicFlushTimer();
    // Flush any leftover mic audio so the tail of the question isn't lost
    // (that tail loss is what made the AI "hear another question").
    try {
      this.flushMicQueue();
    } catch {
      // ignore
    }
    this.micQueue = [];
    this.micQueuedBytes = 0;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    if (this.recordContext && this.recordContext.state !== 'closed') {
      this.recordContext.close().catch(() => {});
      this.recordContext = null;
    }
  }

  /**
   * Plays a 24kHz 16-bit linear PCM audio chunk received from Gemini Live.
   * Schedules immediately with only gapless-chaining delay. Returns the
   * estimated milliseconds until this chunk becomes audible (0 = now).
   */
  playAudioChunk(base64Data: string): number {
    const ctx = this.getAudioContext();

    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Convert Int16 to Float32
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    // Create 24kHz AudioBuffer
    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    // Schedule buffer
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const currentTime = ctx.currentTime;
    if (this.scheduledTime < currentTime) {
      this.scheduledTime = currentTime;
    }

    source.start(this.scheduledTime);
    // Audible delay = gapless queue backlog only (no extra buffering).
    const msUntilAudible = Math.max(0, (this.scheduledTime - currentTime) * 1000);
    this.scheduledTime += audioBuffer.duration;
    this.activeSources.push(source);

    if (this.onSpeakingStateChange) {
      this.onSpeakingStateChange(true);
    }

    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (this.activeSources.length === 0 && this.onSpeakingStateChange) {
        this.onSpeakingStateChange(false);
      }
    };

    return msUntilAudible;
  }

  /**
   * Returns true if microphone capture is currently running.
   * Used to distinguish "AI finished speaking while user is still recording"
   * (→ back to listening) from "AI finished while mic is off" (→ idle).
   */
  isCapturingAudio(): boolean {
    return this.isCapturing;
  }

  /**
   * Returns true if audio is actively being played
   */
  isPlaying(): boolean {
    return this.activeSources.length > 0;
  }

  /**
   * Immediately stops all currently playing and queued audio (called on user interruption)
   */
  interrupt(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
    if (this.audioContext) {
      this.scheduledTime = this.audioContext.currentTime;
    }
    if (this.onSpeakingStateChange) {
      this.onSpeakingStateChange(false);
    }
  }

  /**
   * Closes all audio resources
   */
  close(): void {
    this.stopMicFlushTimer();
    this.stopRecording();
    this.interrupt();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
