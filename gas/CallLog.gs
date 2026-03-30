/**
 * Google Apps Script — 通話記録 Webhook
 *
 * 【セットアップ手順】
 * 1. Google スプレッドシートを新規作成
 * 2. 拡張機能 → Apps Script を開く
 * 3. このファイルの内容を貼り付ける
 * 4. initialSetup() を一度実行して見出し行を作成
 * 5. Apps Script エディタ → プロジェクトの設定 → スクリプトプロパティ
 *    キー: API_KEY  値: （生成したAPIキー）
 * 6. デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセス: 全員
 * 7. 発行された URL と API_KEY をアプリ側の環境変数に設定
 */

/** シート名 */
var SHEET_NAME = "通話記録";
var LOG_SHEET_NAME = "会話ログ";
var CALLBACK_SHEET_NAME = "コールバック管理";

/**
 * 見出し定義（メインシート10項目 — 会話ログ列はリンクに変更）
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
  "会話ログ",
];

/**
 * 会話ログシートの見出し定義
 */
var LOG_HEADERS = [
  "タイムコード",
  "名前",
  "会話ログ",
];

/**
 * コールバック管理シートの見出し定義
 */
var CALLBACK_HEADERS = [
  "id",
  "電話番号",
  "顧客名",
  "担当者名",
  "用件メモ",
  "発信日時",
  "ステータス",
  "更新日時",
  "契約者名",
  "契約住所",
];

/**
 * イニシャルセットアップ — 見出し行を作成
 * Apps Script エディタから手動で一度だけ実行してください。
 */
function initialSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- メインシート（通話記録） ---
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#1a237e");
  headerRange.setFontColor("#ffffff");
  headerRange.setHorizontalAlignment("center");

  sheet.setColumnWidth(1, 180); // タイムコード
  sheet.setColumnWidth(2, 120); // 名前
  sheet.setColumnWidth(3, 140); // カテゴリー
  sheet.setColumnWidth(4, 400); // 内容
  sheet.setColumnWidth(5, 150); // 電話番号
  sheet.setColumnWidth(6, 150); // 契約者名
  sheet.setColumnWidth(7, 250); // 契約住所
  sheet.setColumnWidth(8, 150); // 折返担当者
  sheet.setColumnWidth(9, 120); // 受領者
  sheet.setColumnWidth(10, 150); // 会話ログ（リンク）

  sheet.setFrozenRows(1);

  // --- 会話ログシート ---
  var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(LOG_SHEET_NAME);
  }

  logSheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);

  var logHeaderRange = logSheet.getRange(1, 1, 1, LOG_HEADERS.length);
  logHeaderRange.setFontWeight("bold");
  logHeaderRange.setBackground("#1a237e");
  logHeaderRange.setFontColor("#ffffff");
  logHeaderRange.setHorizontalAlignment("center");

  logSheet.setColumnWidth(1, 180); // タイムコード
  logSheet.setColumnWidth(2, 120); // 名前
  logSheet.setColumnWidth(3, 800); // 会話ログ

  logSheet.setFrozenRows(1);

  // --- コールバック管理シート ---
  var cbSheet = ss.getSheetByName(CALLBACK_SHEET_NAME);
  if (!cbSheet) {
    cbSheet = ss.insertSheet(CALLBACK_SHEET_NAME);
  }

  cbSheet.getRange(1, 1, 1, CALLBACK_HEADERS.length).setValues([CALLBACK_HEADERS]);

  var cbHeaderRange = cbSheet.getRange(1, 1, 1, CALLBACK_HEADERS.length);
  cbHeaderRange.setFontWeight("bold");
  cbHeaderRange.setBackground("#1a237e");
  cbHeaderRange.setFontColor("#ffffff");
  cbHeaderRange.setHorizontalAlignment("center");

  // 電話番号列(B列)をテキスト形式に設定（先頭0を保持）
  cbSheet.getRange("B:B").setNumberFormat("@");

  cbSheet.setColumnWidth(1, 160); // id
  cbSheet.setColumnWidth(2, 150); // 電話番号
  cbSheet.setColumnWidth(3, 150); // 顧客名
  cbSheet.setColumnWidth(4, 150); // 担当者名
  cbSheet.setColumnWidth(5, 300); // 用件メモ
  cbSheet.setColumnWidth(6, 180); // 発信日時
  cbSheet.setColumnWidth(7, 100); // ステータス
  cbSheet.setColumnWidth(8, 180); // 更新日時
  cbSheet.setColumnWidth(9, 150); // 契約者名
  cbSheet.setColumnWidth(10, 250); // 契約住所

  cbSheet.setFrozenRows(1);

  SpreadsheetApp.flush();
  Logger.log("初期セットアップ完了: シート「" + SHEET_NAME + "」「" + LOG_SHEET_NAME + "」「" + CALLBACK_SHEET_NAME + "」を作成しました。");
}

/**
 * POST リクエストを受け取り、スプレッドシートに1行追加する
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // --- APIキー認証 ---
    var expectedKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
    if (expectedKey && data.api_key !== expectedKey) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // --- コールバック管理アクションの分岐 ---
    var action = data.action || "";
    if (action === "add_callback") {
      return handleAddCallback_(data);
    }
    if (action === "update_callback") {
      return handleUpdateCallback_(data);
    }
    if (action === "get_callbacks") {
      return handleGetCallbacks_(data);
    }

    // --- 既存の通話記録処理 ---
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    }

    var timestamp = data.timestamp || new Date().toISOString();
    var callerName = data.caller_name || "不明";
    var conversationLog = data.conversation_log || "";

    // --- 会話ログを別シートに保存 ---
    var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!logSheet) {
      logSheet = ss.insertSheet(LOG_SHEET_NAME);
      logSheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    }

    logSheet.appendRow([timestamp, callerName, conversationLog]);
    var logRow = logSheet.getLastRow();

    // --- メインシートに行を追加（会話ログ列はリンク） ---
    var row = [
      timestamp,
      callerName,
      data.category || "",
      data.summary || "",
      data.callback_number || "",
      data.contract_name || "",
      data.contract_address || "",
      data.callback_assignee || "",
      data.operator || "",
      "", // 会話ログ列 — 下でハイパーリンクを設定
    ];

    sheet.appendRow(row);

    // 会話ログ列にハイパーリンク数式を設定
    var mainRow = sheet.getLastRow();
    var logLink = "=HYPERLINK(\"#gid=" + logSheet.getSheetId() + "&range=C" + logRow + "\",\"会話ログを見る\")";
    sheet.getRange(mainRow, 10).setFormula(logLink);

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

    // --- コールバック管理シートにも自動追加 ---
    var cbSheet = getCallbackSheet_();
    var cbId = String(Date.now());
    var cbStatus = summary.indexOf("要折返") === 0 ? "pending" : "done";
    var cbMemo = (data.category ? data.category + "：" : "") + summary;
    var cbRow = [
      cbId,
      normalizePhone_(data.callback_number),
      callerName,
      data.callback_assignee || data.operator || "",
      cbMemo,
      timestamp,
      cbStatus,
      timestamp,
      data.contract_name || "",
      data.contract_address || "",
    ];
    var cbNewRow = cbSheet.getLastRow() + 1;
    var cbRange = cbSheet.getRange(cbNewRow, 1, 1, cbRow.length);
    cbRange.setNumberFormat("@");
    cbRange.setValues([cbRow]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// コールバック管理ハンドラー
// ============================================================

/**
 * コールバック管理シートを取得（なければ作成）
 */
function getCallbackSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CALLBACK_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CALLBACK_SHEET_NAME);
    sheet.getRange(1, 1, 1, CALLBACK_HEADERS.length).setValues([CALLBACK_HEADERS]);
  }
  return sheet;
}

/**
 * 電話番号を正規化（ハイフン・スペース除去）
 */
function normalizePhone_(phone) {
  return String(phone || "").replace(/[-\s\u3000ー]/g, "");
}

/**
 * JSONレスポンスを生成
 */
function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * add_callback — 新規コールバックレコードを追加
 */
function handleAddCallback_(data) {
  var sheet = getCallbackSheet_();
  var id = String(Date.now());
  var now = new Date().toISOString();

  var memo = data.memo || "";
  var isLogEntry = memo.indexOf("【") === 0; // 【全件対応】【対応内容】等はログエントリ
  var status = isLogEntry ? "done" : (data.status || "pending");

  var row = [
    id,
    normalizePhone_(data.phone),
    data.customer_name || "",
    data.assignee || "",
    memo,
    now,
    status,
    now,
    data.contract_name || "",
    data.contract_address || "",
  ];

  // appendRowは自動型変換されるため、setValuesで書き込む
  var newRow = sheet.getLastRow() + 1;
  var range = sheet.getRange(newRow, 1, 1, row.length);
  range.setNumberFormat("@"); // 全セルをテキスト形式に
  range.setValues([row]);

  return jsonResponse_({ success: true, id: id });
}

/**
 * update_callback — idで行を特定しフィールドを更新
 */
function handleUpdateCallback_(data) {
  var sheet = getCallbackSheet_();
  var targetId = String(data.id);
  var rows = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === targetId) {
      var rowIndex = i + 1; // シートは1始まり
      var oldStatus = rows[i][6];
      if (data.phone !== undefined)         { var cell = sheet.getRange(rowIndex, 2); cell.setNumberFormat("@"); cell.setValue(normalizePhone_(data.phone)); }
      if (data.customer_name !== undefined)  sheet.getRange(rowIndex, 3).setValue(data.customer_name);
      if (data.assignee !== undefined)       sheet.getRange(rowIndex, 4).setValue(data.assignee);
      if (data.memo !== undefined)           sheet.getRange(rowIndex, 5).setValue(data.memo);
      if (data.status !== undefined)         sheet.getRange(rowIndex, 7).setValue(data.status);
      if (data.contract_name !== undefined)  sheet.getRange(rowIndex, 9).setValue(data.contract_name);
      if (data.contract_address !== undefined) sheet.getRange(rowIndex, 10).setValue(data.contract_address);
      // 更新日時を記録
      sheet.getRange(rowIndex, 8).setValue(new Date().toISOString());

      // ステータス変更時はログエントリを自動追加
      if (data.status !== undefined && data.status !== oldStatus) {
        var phone = String(rows[i][1]);
        var customerName = rows[i][2];
        var statusLabel = data.status === "done" ? "対応済みに変更" : "未対応に変更";
        var logMemo = "【ステータス変更】" + statusLabel + (data.operator ? "（" + data.operator + "）" : "");
        var logId = String(Date.now());
        var now = new Date().toISOString();
        var logRow = [logId, phone, customerName, data.operator || "", logMemo, now, "done", now];
        var logNewRow = sheet.getLastRow() + 1;
        var logRange = sheet.getRange(logNewRow, 1, 1, logRow.length);
        logRange.setNumberFormat("@");
        logRange.setValues([logRow]);
      }

      return jsonResponse_({ success: true });
    }
  }

  return jsonResponse_({ success: false, message: "id not found: " + targetId });
}

/**
 * get_callbacks — 全レコード（またはステータス絞り込み）を返す
 */
function handleGetCallbacks_(data) {
  var sheet = getCallbackSheet_();
  var rows = sheet.getDataRange().getValues();
  var statusFilter = data.status || "";
  var records = [];

  for (var i = 1; i < rows.length; i++) {
    var record = {
      id:            String(rows[i][0]),
      phone:         String(rows[i][1]),
      customer_name: rows[i][2],
      assignee:      rows[i][3],
      memo:          rows[i][4],
      created_at:    rows[i][5],
      status:        rows[i][6],
      updated_at:    rows[i][7],
      contract_name: rows[i][8] || "",
      contract_address: rows[i][9] || "",
    };
    if (statusFilter && record.status !== statusFilter) continue;
    records.push(record);
  }

  return jsonResponse_({ records: records });
}

/**
 * GET リクエスト — 動作確認用
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", message: "Call Log Webhook is running" }))
    .setMimeType(ContentService.MimeType.JSON);
}
