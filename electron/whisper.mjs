import { pipeline, env } from "@huggingface/transformers";
import { app } from "electron";
import path from "path";

// キャッシュディレクトリ: userData 配下に保存（ONNX の非ASCII パス問題を回避するため
// フォールバックとして C:\hikari-whisper を使用）
function getCacheDir() {
  try {
    const ud = app.getPath("userData");
    // パスに非ASCII文字が含まれる場合は固定パスにフォールバック
    if (/[^\x00-\x7F]/.test(ud)) {
      return "C:\\hikari-whisper";
    }
    return path.join(ud, "whisper-models");
  } catch {
    return "C:\\hikari-whisper";
  }
}

env.cacheDir = getCacheDir();

// Electron の asar 内では WASM ファイルが見つからないため
// onnxruntime-node のバックエンドを明示的に使用
env.backends.onnx.wasm.numThreads = 4;

// モデル設定
const AVAILABLE_MODELS = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
};

let _pipe = null;
let _currentModel = null;

async function getPipeline(modelSize = "small") {
  const modelId = AVAILABLE_MODELS[modelSize] || AVAILABLE_MODELS.small;
  if (_pipe && _currentModel === modelId) return _pipe;

  // モデルが変わった場合はリセット
  if (_pipe && _currentModel !== modelId) {
    _pipe = null;
    _currentModel = null;
  }

  console.log(`[whisper] モデルを初期化中: ${modelId}（初回はダウンロードが発生します）...`);
  _pipe = await pipeline(
    "automatic-speech-recognition",
    modelId,
    { dtype: "q8" }
  );
  _currentModel = modelId;
  console.log("[whisper] モデル初期化完了");
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
function stripSoundNotations(text) {
  return text.replace(/[（(][^）)]{1,10}[）)]/g, "").trim();
}

function isHallucination(text) {
  return HALLUCINATION_PATTERNS.some((re) => re.test(text));
}

/**
 * 16kHz / Float32Array の音声データをテキストに変換する
 * @param {ArrayBuffer} arrayBuffer  resampleTo16k 後の Float32Array バッファ
 * @param {string} modelSize  モデルサイズ ("tiny" | "base" | "small")
 * @returns {Promise<string>}  認識テキスト
 */
export async function transcribeBuffer(arrayBuffer, modelSize = "small") {
  const float32 = new Float32Array(arrayBuffer);
  const pipe = await getPipeline(modelSize);
  const result = await pipe(float32, {
    language: "japanese",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
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

/**
 * 利用可能なモデル一覧を返す
 */
export function getAvailableModels() {
  return Object.keys(AVAILABLE_MODELS);
}

/**
 * 現在のキャッシュディレクトリを返す
 */
export function getWhisperCacheDir() {
  return env.cacheDir;
}
