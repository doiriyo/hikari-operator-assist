import { pipeline, env } from "@huggingface/transformers";

// ONNX Runtime は非ASCII パスを処理できないため C:\hikari-whisper に固定
env.cacheDir = "C:\\hikari-whisper";

// Electron の asar 内では WASM ファイルが見つからないため
// onnxruntime-node のバックエンドを明示的に使用
env.backends.onnx.wasm.numThreads = 4;

let _pipe = null;

async function getPipeline() {
  if (!_pipe) {
    console.log("[whisper] モデルを初期化中（初回はダウンロードが発生します）...");
    // Xenova/whisper-base は multilingual / 日本語対応
    // dtype: 'q8' で量子化し速度・メモリを最適化
    _pipe = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-small",
      { dtype: "q8" }
    );
    console.log("[whisper] モデル初期化完了");
  }
  return _pipe;
}

// Whisper が無音や音楽を誤認識してしまいやすい定型フレーズ（ハルシネーション）
// 一致した場合は空文字を返す
const HALLUCINATION_PATTERNS = [
  /^ご視聴ありがとうございました[。！]?$/,
  /^チャンネル登録/,
  /^字幕は自動生成/,
  /^翻訳.*提供/,
  /^\s*$/, // 空白のみ
  /^[。、！？…\s]+$/, // 句読点のみ
  /^[（(][^）)]*[）)]$/, // 行全体が括弧（Whisper の音響イベント表記: （音楽）（スパッ）等）
];

// 会話文中に混入した短い音響イベント表記を除去する
// 例: "こんにちは（スパッ）" → "こんにちは"
// 10文字以内に限定することで正当な括弧表現は残す
function stripSoundNotations(text) {
  return text.replace(/[（(][^）)]{1,10}[）)]/g, "").trim();
}

function isHallucination(text) {
  return HALLUCINATION_PATTERNS.some((re) => re.test(text));
}

/**
 * 16kHz / Float32Array の音声データをテキストに変換する
 * @param {ArrayBuffer} arrayBuffer  resampleTo16k 後の Float32Array バッファ
 * @returns {Promise<string>}  認識テキスト
 */
export async function transcribeBuffer(arrayBuffer) {
  const float32 = new Float32Array(arrayBuffer);
  const pipe = await getPipeline();
  const result = await pipe(float32, {
    language: "japanese",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
    // コールセンター会話のコンテキストを与えることで
    // 環境音・音楽のノイズをテキスト化しにくくする
    initial_prompt:
      'これはインターネット光回線の電話サポートです。' +
      '阿蘇市（一の宮町宮地、坂梨、中坂梨、北坂梨、三野、手野、中通、荻の草、' +
      '内牧、小里、南宮原、湯浦、西湯浦、西小園、三久保、山田、小倉、小池、' +
      '黒流町、今町、小野田、役犬原、西町、竹原、蔵原、黒川、乙姫、永草、' +
      '赤水、車帰、無田、狩尾、跡ケ瀬、的石、' +
      '波野赤仁田、小園、小地野、新波野、中江、滝水）' +
      'および産山村（山鹿、田尻）の住所が登場します。' +
      'ONU、ルーター、Wi-Fi、SSID、AGマネージャ、阿蘇光、' +
      '加入君、お知らせ端末、口座振替、インボイス。',
  });
  const text = stripSoundNotations((result?.text ?? "").trim());
  if (isHallucination(text)) return "";
  return text;
}
