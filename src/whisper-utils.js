/**
 * Whisper 音声処理ユーティリティ
 *
 * - resampleTo16k : ブラウザのサンプルレートから 16kHz へリサンプリング
 * - encodeWAV     : Float32Array → 16bit / mono / PCM WAV バイト列
 */

/**
 * Float32Array を任意のサンプルレートから 16kHz にリサンプリングする
 * @param {Float32Array} float32Array  入力 PCM データ
 * @param {number} fromSampleRate     入力のサンプルレート（例: 44100, 48000）
 * @returns {Promise<Float32Array>}   16kHz にリサンプリングされた PCM データ
 */
export async function resampleTo16k(float32Array, fromSampleRate) {
  if (fromSampleRate === 16000) return float32Array;

  const outLength = Math.ceil(float32Array.length * 16000 / fromSampleRate);
  const offlineCtx = new OfflineAudioContext(1, outLength, 16000);

  const buffer = offlineCtx.createBuffer(1, float32Array.length, fromSampleRate);
  buffer.copyToChannel(float32Array, 0);

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Float32Array PCM を WAV バイト列（16bit / mono）にエンコードする
 * @param {Float32Array} samples  PCM サンプル（-1.0 〜 1.0）
 * @param {number} sampleRate    サンプルレート（whisper 向けは 16000）
 * @returns {Uint8Array}         WAV バイト列
 */
export function encodeWAV(samples, sampleRate = 16000) {
  const dataLen = samples.length * 2; // 16bit = 2 bytes/sample
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF チャンクヘッダ
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");

  // fmt チャンク
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);           // チャンクサイズ
  view.setUint16(20, 1, true);            // PCM フォーマット
  view.setUint16(22, 1, true);            // モノラル
  view.setUint32(24, sampleRate, true);   // サンプルレート
  view.setUint32(28, sampleRate * 2, true); // バイトレート
  view.setUint16(32, 2, true);            // ブロックアライン
  view.setUint16(34, 16, true);           // ビット深度

  // data チャンク
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);

  // Float32 → Int16 変換
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buf);
}
