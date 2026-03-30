/**
 * AudioWorklet プロセッサ — PCM チャンクを収集してメインスレッドへ送信
 *
 * メッセージプロトコル:
 *   プロセッサ → メインスレッド:
 *     { type: 'chunk', samples: Float32Array }  — 音声チャンク
 *
 *   メインスレッド → プロセッサ:
 *     { type: 'flush' }  — 残バッファを即時送信
 *     { type: 'stop'  }  — プロセッサ停止
 *
 * 送信タイミング:
 *   1. 発話後に SILENCE_TRIGGER_SECONDS 秒の無音 → 即時送信（文の区切りで送る）
 *   2. 上記なしで MAX_CHUNK_SECONDS を超えた場合 → 強制送信
 */

// 発話後の無音がこの秒数続いたら即時送信（自然な区切りで切る）
const SILENCE_TRIGGER_SECONDS = 0.5;

// 無音が続いても強制送信する最大チャンク長
const MAX_CHUNK_SECONDS = 6;

// RMS がこの閾値未満のフレームは無音とみなす
// 0.005 ≒ -46 dBFS: 通常の会話音声は 0.02〜0.1 程度
const RMS_THRESHOLD = 0.005;

function calcRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sr = options.processorOptions?.sampleRate ?? 44100;
    // process() は 128 サンプル単位で呼ばれる
    this._maxChunkSize = Math.round(sr * MAX_CHUNK_SECONDS);
    this._silenceTriggerFrames = Math.round((sr * SILENCE_TRIGGER_SECONDS) / 128);
    this._buf = [];
    this._running = true;
    this._hadSpeech = false;   // 現在のバッファに発話があったか
    this._silenceFrames = 0;   // 発話後に連続した無音フレーム数

    this.port.onmessage = (e) => {
      if (e.data.type === "flush") {
        this._sendChunk();
      } else if (e.data.type === "stop") {
        this._sendChunk();
        this._running = false;
      }
    };
  }

  _sendChunk() {
    if (this._buf.length === 0) return;
    const chunk = new Float32Array(this._buf);
    this._buf = [];
    this._hadSpeech = false;
    this._silenceFrames = 0;
    // チャンク全体の RMS が閾値未満なら無音として破棄
    if (calcRms(chunk) < RMS_THRESHOLD) return;
    this.port.postMessage({ type: "chunk", samples: chunk }, [chunk.buffer]);
  }

  process(inputs) {
    if (!this._running) return false;
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const rms = calcRms(channel);

    for (let i = 0; i < channel.length; i++) {
      this._buf.push(channel[i]);
    }

    if (rms >= RMS_THRESHOLD) {
      // 発話フレーム: カウンタリセット
      this._hadSpeech = true;
      this._silenceFrames = 0;
    } else if (this._hadSpeech) {
      // 発話後の無音フレーム
      this._silenceFrames++;
      if (this._silenceFrames >= this._silenceTriggerFrames) {
        // 発話後に十分な無音 → 文の区切りとして即時送信
        this._sendChunk();
        return true;
      }
    }

    // 最大チャンク長を超えたら強制送信
    if (this._buf.length >= this._maxChunkSize) {
      this._sendChunk();
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
