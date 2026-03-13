/**
 * Google Apps Script — 通話記録 Webhook
 *
 * 【セットアップ手順】
 * 1. Google スプレッドシートを新規作成
 * 2. 拡張機能 → Apps Script を開く
 * 3. このファイルの内容を貼り付ける
 * 4. initialSetup() を一度実行して見出し行を作成
 * 5. デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセス: 全員
 * 6. 発行された URL を App.jsx の GAS_WEBHOOK_URL に設定
 */

/** シート名 */
var SHEET_NAME = "通話記録";

/**
 * 見出し定義（9項目）
 */
var HEADERS = [
  "タイムコード",
  "名前",
  "カテゴリー",
  "内容",
  "電話番号",
  "契約者名",
  "契約住所",
  "折返担当者",
  "受領者",
];

/**
 * イニシャルセットアップ — 見出し行を作成
 * Apps Script エディタから手動で一度だけ実行してください。
 */
function initialSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // 見出し行を書き込み
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  // 見出し行のスタイリング
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#1a237e");
  headerRange.setFontColor("#ffffff");
  headerRange.setHorizontalAlignment("center");

  // 列幅を設定
  sheet.setColumnWidth(1, 180); // タイムコード
  sheet.setColumnWidth(2, 120); // 名前
  sheet.setColumnWidth(3, 140); // カテゴリー
  sheet.setColumnWidth(4, 400); // 内容
  sheet.setColumnWidth(5, 150); // 電話番号
  sheet.setColumnWidth(6, 150); // 契約者名
  sheet.setColumnWidth(7, 250); // 契約住所
  sheet.setColumnWidth(8, 150); // 折返担当者
  sheet.setColumnWidth(9, 120); // 受領者

  // 1行目を固定
  sheet.setFrozenRows(1);

  SpreadsheetApp.flush();
  Logger.log("初期セットアップ完了: シート「" + SHEET_NAME + "」に見出しを作成しました。");
}

/**
 * POST リクエストを受け取り、スプレッドシートに1行追加する
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    }

    var row = [
      data.timestamp || new Date().toISOString(),
      data.caller_name || "不明",
      data.category || "",
      data.summary || "",
      data.callback_number || "",
      data.contract_name || "",
      data.contract_address || "",
      data.callback_assignee || "",
      data.operator || "",
    ];

    sheet.appendRow(row);

    // 「要折返」で始まる内容の行を強調表示
    var summary = data.summary || "";
    if (summary.indexOf("要折返") === 0) {
      var lastRow = sheet.getLastRow();
      var rowRange = sheet.getRange(lastRow, 1, 1, HEADERS.length);
      rowRange.setBackground("#fff3e0");
      rowRange.setFontColor("#e65100");
      // 内容セルを太字に
      sheet.getRange(lastRow, 4).setFontWeight("bold");
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * GET リクエスト — 動作確認用
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", message: "Call Log Webhook is running" }))
    .setMimeType(ContentService.MimeType.JSON);
}
