// src/address-corrections.js
// 阿蘇市・産山村の音声認識誤りを正しい住所漢字表記に補正するモジュール

/**
 * 置換テーブル
 * key   : 音声認識でよく出る誤り表記（ひらがな・カタカナ・誤漢字）
 * value : 正しい表記
 *
 * 優先度の高い（長い・具体的な）パターンを先に並べること。
 * 運用中に誤りパターンが蓄積したらここに追加する。
 */
export const ADDRESS_CORRECTIONS = [
  // ── 阿蘇市 ──────────────────────────────────────────
  // 市名
  { pattern: /あそし/g,           replacement: '阿蘇市' },
  { pattern: /アソシ/g,           replacement: '阿蘇市' },
  { pattern: /阿蘇志/g,           replacement: '阿蘇市' },
  { pattern: /朝鮮市/g,           replacement: '阿蘇市' },   // まれな誤認識例

  // 一の宮町（いちのみや）
  { pattern: /いちのみやまち/g,   replacement: '一の宮町' },
  { pattern: /いちのみや/g,       replacement: '一の宮町' },
  { pattern: /一ノ宮町/g,         replacement: '一の宮町' },
  { pattern: /一ノ宮/g,           replacement: '一の宮' },
  { pattern: /市の宮/g,           replacement: '一の宮' },
  { pattern: /イチノミヤ/g,       replacement: '一の宮町' },
  { pattern: /一飲み甘ち/g,       replacement: '一の宮町' },
  { pattern: /一飲みやまち/g,       replacement: '一の宮町' },
  { pattern: /一飲み山地 /g,       replacement: '一の宮町' },
  { pattern: /一飲み山 /g,       replacement: '一の宮町' },

  // 内牧（うちのまき）
  { pattern: /うちのまき/g,       replacement: '内牧' },
  { pattern: /ウチノマキ/g,       replacement: '内牧' },
  { pattern: /内の巻/g,           replacement: '内牧' },
  { pattern: /内の槇/g,           replacement: '内牧' },

  // 宮地（みやじ）
  { pattern: /みやじ/g,           replacement: '宮地' },
  { pattern: /ミヤジ/g,           replacement: '宮地' },
  { pattern: /宮路/g,             replacement: '宮地' },
  { pattern: /宮次/g,             replacement: '宮地' },
  { pattern: /宮市/g,             replacement: '宮地' },

  // 波野（なみの）
  { pattern: /なみの/g,           replacement: '波野' },
  { pattern: /ナミノ/g,           replacement: '波野' },
  { pattern: /波之/g,             replacement: '波野' },

  // 黒川（くろかわ）
  { pattern: /くろかわ/g,         replacement: '黒川' },
  { pattern: /クロカワ/g,         replacement: '黒川' },

  // 乙姫（おとひめ）
  { pattern: /おとひめ/g,         replacement: '乙姫' },
  { pattern: /オトヒメ/g,         replacement: '乙姫' },
  { pattern: /乙媛/g,             replacement: '乙姫' },

  // 尾ヶ石（おがいし）
  { pattern: /おがいし/g,         replacement: '尾ヶ石' },
  { pattern: /オガイシ/g,         replacement: '尾ヶ石' },
  { pattern: /尾が石/g,           replacement: '尾ヶ石' },

  // 古城（こじょう）
  { pattern: /こじょう/g,         replacement: '古城' },
  { pattern: /コジョウ/g,         replacement: '古城' },

  // 坂梨（さかなし）
  { pattern: /さかなし/g,         replacement: '坂梨' },
  { pattern: /サカナシ/g,         replacement: '坂梨' },
  { pattern: /坂無し/g,           replacement: '坂梨' },
  { pattern: /魚市/g,           replacement: '坂梨' },

  // 三野（さんの）  
  { pattern: /さんの/g,           replacement: '三野' },
  { pattern: /サンノ/g,           replacement: '三野' },
  { pattern: /三ノ/g,             replacement: '三野' }, 

  // 永草（ながくさ）
  { pattern: /ながくさ/g,         replacement: '永草' },
  { pattern: /ナガクサ/g,         replacement: '永草' },
  { pattern: /長草/g,             replacement: '永草' },
  { pattern: /長くさ/g,             replacement: '永草' },

  // 狩尾（かりお）
  { pattern: /かりお/g,           replacement: '狩尾' },
  { pattern: /カリオ/g,           replacement: '狩尾' },
  { pattern: /刈尾/g,             replacement: '狩尾' },
  { pattern: /仮を/g,             replacement: '狩尾' },

  // 小里（おざと）
  { pattern: /おざと/g,           replacement: '小里' },
  { pattern: /オザト/g,           replacement: '小里' },
  { pattern: /小郷/g,             replacement: '小里' },

  // 中坂梨（なかさかなし）
  { pattern: /なかさかなし/g,     replacement: '中坂梨' },
  { pattern: /ナカサカナシ/g,     replacement: '中坂梨' },

  // 北坂梨（きたさかなし）
  { pattern: /きたさかなし/g,     replacement: '北坂梨' },
  { pattern: /キタサカナシ/g,     replacement: '北坂梨' },

  // 手野（ての）
  { pattern: /ての/g,             replacement: '手野' },
  { pattern: /テノ/g,             replacement: '手野' },

  // 中通（なかどおり）
  { pattern: /なかどおり/g,       replacement: '中通' },
  { pattern: /ナカドオリ/g,       replacement: '中通' },
  { pattern: /中通り/g,           replacement: '中通' },

  // 荻の草（おぎのくさ）
  { pattern: /おぎのくさ/g,       replacement: '荻の草' },
  { pattern: /オギノクサ/g,       replacement: '荻の草' },
  { pattern: /荻ノ草/g,           replacement: '荻の草' },
  { pattern: /お気の草/g,           replacement: '荻の草' },

  // 南宮原（みなみみやばる）
  { pattern: /みなみみやばる/g,   replacement: '南宮原' },
  { pattern: /ミナミミヤバル/g,   replacement: '南宮原' },

  // 湯浦（ゆのうら）
  { pattern: /ゆのうら/g,         replacement: '湯浦' },
  { pattern: /ユノウラ/g,         replacement: '湯浦' },
  { pattern: /湯ノ浦/g,           replacement: '湯浦' },

  // 西湯浦（にしゆのうら）
  { pattern: /にしゆのうら/g,     replacement: '西湯浦' },
  { pattern: /ニシユノウラ/g,     replacement: '西湯浦' },

  // 西小園（にしこぞの）
  { pattern: /にしこぞの/g,       replacement: '西小園' },
  { pattern: /ニシコゾノ/g,       replacement: '西小園' },

  // 三久保（みくぼ）
  { pattern: /みくぼ/g,           replacement: '三久保' },
  { pattern: /ミクボ/g,           replacement: '三久保' },

  // 山田（やまだ）
  { pattern: /やまだ/g,           replacement: '山田' },
  { pattern: /ヤマダ/g,           replacement: '山田' },

  // 小倉（おくら）
  { pattern: /おくら/g,           replacement: '小倉' },
  { pattern: /オクラ/g,           replacement: '小倉' },

  // 小池（こうじ）
  { pattern: /こうじ/g,           replacement: '小池' },
  { pattern: /コウジ/g,           replacement: '小池' },

  // 黒流町（くろながれまち）
  { pattern: /くろながれまち/g,   replacement: '黒流町' },
  { pattern: /クロナガレマチ/g,   replacement: '黒流町' },

  // 今町（いままち）
  { pattern: /いままち/g,         replacement: '今町' },
  { pattern: /イママチ/g,         replacement: '今町' },

  // 小野田（おのだ）
  { pattern: /おのだ/g,           replacement: '小野田' },
  { pattern: /オノダ/g,           replacement: '小野田' },

  // 役犬原（やくいんばる）
  { pattern: /やくいんばる/g,     replacement: '役犬原' },
  { pattern: /ヤクインバル/g,     replacement: '役犬原' },
  { pattern: /役員原/g,           replacement: '役犬原' },
  { pattern: /薬院原/g,           replacement: '役犬原' },

  // 西町（にしまち）
  { pattern: /にしまち/g,         replacement: '西町' },
  { pattern: /ニシマチ/g,         replacement: '西町' },

  // 竹原（たかわら）
  { pattern: /たかわら/g,         replacement: '竹原' },
  { pattern: /タカワラ/g,         replacement: '竹原' },
  { pattern: /高原/g,             replacement: '竹原' },

  // 蔵原（くらばる）
  { pattern: /くらばる/g,         replacement: '蔵原' },
  { pattern: /クラバル/g,         replacement: '蔵原' },
  { pattern: /倉原/g,             replacement: '蔵原' },

  // 赤水（あかみず）
  { pattern: /あかみず/g,         replacement: '赤水' },
  { pattern: /アカミズ/g,         replacement: '赤水' },

  // 車帰（くるまがえり）
  { pattern: /くるまがえり/g,     replacement: '車帰' },
  { pattern: /クルマガエリ/g,     replacement: '車帰' },
  { pattern: /車返り/g,           replacement: '車帰' },
  { pattern: /車返/g,             replacement: '車帰' },

  // 無田（むた）
  { pattern: /むた/g,             replacement: '無田' },
  { pattern: /ムタ/g,             replacement: '無田' },

  // 跡ケ瀬（あどがせ）
  { pattern: /あどがせ/g,         replacement: '跡ケ瀬' },
  { pattern: /アドガセ/g,         replacement: '跡ケ瀬' },
  { pattern: /跡が瀬/g,           replacement: '跡ケ瀬' },

  // 的石（まといし）
  { pattern: /まといし/g,         replacement: '的石' },
  { pattern: /マトイシ/g,         replacement: '的石' },
  { pattern: /的石/g,             replacement: '的石' },

  // ── 波野大字 ────────────────────────────────────────
  // 赤仁田（あかにた）
  { pattern: /あかにた/g,         replacement: '赤仁田' },
  { pattern: /アカニタ/g,         replacement: '赤仁田' },

  // 小園（おぞの）
  { pattern: /おぞの/g,           replacement: '小園' },
  { pattern: /オゾノ/g,           replacement: '小園' },

  // 小地野（しょうちの）
  { pattern: /しょうちの/g,       replacement: '小地野' },
  { pattern: /ショウチノ/g,       replacement: '小地野' },

  // 新波野（しんなみの）
  { pattern: /しんなみの/g,       replacement: '新波野' },
  { pattern: /シンナミノ/g,       replacement: '新波野' },

  // 中江（なかえ）
  { pattern: /なかえ/g,           replacement: '中江' },
  { pattern: /ナカエ/g,           replacement: '中江' },

  // 滝水（たきみず）
  { pattern: /たきみず/g,         replacement: '滝水' },
  { pattern: /タキミズ/g,         replacement: '滝水' },

  // ── 産山村 ──────────────────────────────────────────
  // 村名
  { pattern: /うぶやまむら/g,     replacement: '産山村' },
  { pattern: /うぶやま/g,         replacement: '産山村' },
  { pattern: /ウブヤマ/g,         replacement: '産山村' },
  { pattern: /産山むら/g,         replacement: '産山村' },
  { pattern: /産山ムラ/g,         replacement: '産山村' },
  { pattern: /産やま/g,           replacement: '産山' },

  // 山鹿（やまが）
  { pattern: /やまが/g,           replacement: '山鹿' },
  { pattern: /ヤマガ/g,           replacement: '山鹿' },
  { pattern: /山賀/g,             replacement: '山鹿' },

  // 田尻（たじり）
  { pattern: /たじり/g,           replacement: '田尻' },
  { pattern: /タジリ/g,           replacement: '田尻' },
  { pattern: /田尾/g,             replacement: '田尻' },

  // ── 番地・号の読み誤り ───────────────────────────────
  { pattern: /ばんち/g,           replacement: '番地' },
  { pattern: /ばんてい/g,         replacement: '番地' },
  { pattern: /ごう$/g,            replacement: '号' },   // 行末の「ごう」
  { pattern: /ちょうめ/g,         replacement: '丁目' },
];

// ── カスタム補正パターン（localStorage 永続化）──────────────
const CUSTOM_CORRECTIONS_KEY = "custom_speech_corrections";

/**
 * カスタム補正一覧を取得する
 * @returns {{ from: string, to: string }[]}
 */
export function loadCustomCorrections() {
  try {
    const raw = localStorage.getItem(CUSTOM_CORRECTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * カスタム補正一覧を保存する
 * @param {{ from: string, to: string }[]} corrections
 */
export function saveCustomCorrections(corrections) {
  localStorage.setItem(CUSTOM_CORRECTIONS_KEY, JSON.stringify(corrections));
}

/**
 * カスタム補正を1件追加する（重複チェック付き）
 * @param {string} from - 誤認識テキスト
 * @param {string} to   - 正しいテキスト
 * @returns {{ from: string, to: string }[]} 更新後の一覧
 */
export function addCustomCorrection(from, to) {
  const list = loadCustomCorrections();
  // 同じ from が既にあれば上書き
  const idx = list.findIndex(c => c.from === from);
  if (idx >= 0) {
    list[idx].to = to;
  } else {
    list.push({ from, to });
  }
  saveCustomCorrections(list);
  return list;
}

/**
 * カスタム補正を1件削除する
 * @param {number} index
 * @returns {{ from: string, to: string }[]} 更新後の一覧
 */
export function removeCustomCorrection(index) {
  const list = loadCustomCorrections();
  list.splice(index, 1);
  saveCustomCorrections(list);
  return list;
}

/**
 * normalizeAddress(text)
 * 文字起こしテキスト中の住所誤りを置換テーブルで一括補正する。
 * ビルトイン補正 → カスタム補正 の順に適用。
 *
 * @param  {string} text - 文字起こし生テキスト
 * @returns {string}       補正済みテキスト
 */
export function normalizeAddress(text) {
  if (!text) return text;
  // 1. ビルトイン補正
  let result = ADDRESS_CORRECTIONS.reduce(
    (acc, { pattern, replacement }) => acc.replace(pattern, replacement),
    text
  );
  // 2. カスタム補正（ユーザー追加分）
  const custom = loadCustomCorrections();
  for (const { from, to } of custom) {
    result = result.replaceAll(from, to);
  }
  return result;
}
