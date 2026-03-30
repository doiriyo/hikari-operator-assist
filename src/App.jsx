import { useState, useEffect, useRef, useCallback } from "react";
import { resampleTo16k } from "./whisper-utils.js";
import { normalizeAddress, loadCustomCorrections, addCustomCorrection, removeCustomCorrection } from "./address-corrections.js";

// Electron 環境検出 — true のとき Whisper ローカル文字起こしを使用
const isElectron = window.electronAPI?.isElectron ?? false;

const DIFY_API_URL = import.meta.env.VITE_DIFY_API_URL || "https://api.dify.ai/v1/chat-messages";
const DIFY_API_KEY = import.meta.env.VITE_DIFY_API_KEY || "";
const GAS_WEBHOOK_URL = import.meta.env.VITE_GAS_URL || "";
const GAS_API_KEY = import.meta.env.VITE_GAS_API_KEY || "";

const MOCK_KB = [
  {
    keywords: ["繋がらない","接続できない","インターネット","ネット","切れる","切断"],
    category: "接続障害",
    steps: [
      "ONUのランプ状態を確認（PONランプが緑点灯しているか）",
      "ONU → ルーターの順に電源を抜き、1分待って再起動",
      "PCのIPアドレスが正常に取得できているか確認（169.x.x.xはNG）",
      "改善しない場合は工事担当者へエスカレーション（内線#201）",
    ],
    tip: "「ONU」という言葉はお客様に伝わりにくいため「光の機械」と言い換えるとスムーズです。",
  },
  {
    keywords: ["遅い","速度","重い","動画","YouTube","ストリーミング"],
    category: "速度低下",
    steps: [
      "speedtest.netで実測値を確認（目安：100Mbps以上で通常利用は快適）",
      "Wi-Fi利用の場合は有線接続で速度を比較",
      "時間帯による混雑の可能性を説明（夜19〜23時は帯域混雑しやすい）",
      "ルーターの置き場所・障害物の影響を確認",
    ],
    tip: "お客様がWi-Fiと光回線の違いを混同しているケースが多いです。丁寧に切り分けを。",
  },
  {
    keywords: ["料金","請求","値段","いくら","高い","支払い","振込"],
    category: "料金・請求",
    steps: [
      "現在のご契約プランを確認（マイページ or 社内CRM）",
      "請求書の発行月と金額を照合",
      "初月のみ日割り計算のため高くなることを説明",
      "支払い方法変更はWebまたは電話窓口（内線#202）へ案内",
    ],
    tip: "料金への不満は解約につながりやすいため、共感を示しながら丁寧に対応しましょう。",
  },
  {
    keywords: ["解約","やめたい","辞める","キャンセル","退会"],
    category: "解約・退会",
    steps: [
      "解約理由をヒアリング（引越し / 不満 / 競合乗り換え）",
      "引越しの場合は移転サービスの案内を優先",
      "不満の場合は原因解決を提案（速度改善・料金プラン見直し等）",
      "解約手続きはWebフォームまたは書面（要本人確認）",
    ],
    tip: "即答せず、まず理由を聞くことが大切。多くの場合、別の解決策で引き留められます。",
  },
  {
    keywords: ["設定","ルーター","Wi-Fi","パスワード","SSID","接続方法"],
    category: "機器設定",
    steps: [
      "ルーター底面のSSID・パスワードシールを確認するよう案内",
      "スマホのWi-Fi設定から該当SSIDを選択",
      "5GHz(高速・近距離向き)と2.4GHz(広範囲)の違いを説明",
      "設定が難しい場合は訪問サポートを案内（内線#203）",
    ],
    tip: "高齢のお客様にはSSID・パスワードを「Wi-Fiの名前と暗号」と言い換えると伝わりやすいです。",
  },
];

function searchKB(text) {
  if (!text || text.length < 3) return [];
  const lower = text.toLowerCase().replace(/\s/g, "");
  return MOCK_KB
    .map(item => ({ ...item, score: item.keywords.filter(k => lower.includes(k)).length }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function extractPhoneNumber(text) {
  const normalized = text.replace(/[\s\u3000]/g, "");
  // 携帯: 090/080/070、固定: 0X-XXXX-XXXX、フリーダイヤル: 0120/0800
  const match = normalized.match(/0[0-9]{1,4}[-ー]?[0-9]{1,4}[-ー]?[0-9]{3,4}/);
  return match ? match[0] : null;
}

// ── デバイス設定の永続化キー ──
const DEVICE_SETTINGS_KEY = "audio_device_settings";

function loadDeviceSettings() {
  try {
    const raw = localStorage.getItem(DEVICE_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { operatorDeviceId: "", customerDeviceId: "", dualMode: false, triggerEnabled: false, triggerDeviceId: "" };
  } catch {
    return { operatorDeviceId: "", customerDeviceId: "", dualMode: false };
  }
}

function saveDeviceSettings(settings) {
  localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(settings));
}

const SESSION_KEY = "operator_session";
const SESSION_TTL = 6 * 60 * 60 * 1000; // 6時間

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() - session.timestamp > SESSION_TTL) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session.name;
  } catch {
    return null;
  }
}

function saveSession(name) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ name, timestamp: Date.now() }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export default function App() {
  const [operatorName, setOperatorName] = useState(() => loadSession() || "");
  const [loginInput, setLoginInput] = useState("");
  const isLoggedIn = !!operatorName;

  const [transcript, setTranscript] = useState([]);
  const [kbResults, setKbResults] = useState([]);
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [pinnedAiResponse, setPinnedAiResponse] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [inputText, setInputText] = useState("");
  const [animateResult, setAnimateResult] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [interimText, setInterimText] = useState("");
  const [speechDebug, setSpeechDebug] = useState([]);
  const [micLevel, setMicLevel] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState(""); // "" | "summarizing" | "saving" | "saved" | "error"
  const [callSummary, setCallSummary] = useState(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [editableSummary, setEditableSummary] = useState({
    timestamp: "",
    caller_name: "",
    category: "",
    summary: "",
    callback_number: "",
    contract_name: "",
    contract_address: "",
    callback_assignee: "",
    operator: "",
  });
  // ── デバイス選択 ──
  const [audioDevices, setAudioDevices] = useState([]);
  const [operatorDeviceId, setOperatorDeviceId] = useState(() => loadDeviceSettings().operatorDeviceId);
  const [customerDeviceId, setCustomerDeviceId] = useState(() => loadDeviceSettings().customerDeviceId);
  const [dualMode, setDualMode] = useState(() => loadDeviceSettings().dualMode);
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  // ── カスタム補正パターン管理 ──
  const [showCorrectionPanel, setShowCorrectionPanel] = useState(false);
  const [customCorrections, setCustomCorrections] = useState(() => loadCustomCorrections());
  const [correctionFrom, setCorrectionFrom] = useState("");
  const [correctionTo, setCorrectionTo] = useState("");
  const [triggerEnabled, setTriggerEnabled] = useState(() => loadDeviceSettings().triggerEnabled ?? false);
  const [triggerDeviceId, setTriggerDeviceId] = useState(() => loadDeviceSettings().triggerDeviceId ?? "");
  // ── アプリ切り替え ──
  const [appView, setAppView] = useState("assist"); // "assist" | "manager"
  const lastPhoneTimestampRef = useRef(null);
  const operatorIframeRef = useRef(null);
  const customerIframeRef = useRef(null);
  const customerInterimRef = useRef("");

  const debugModeRef = useRef(false);
  const transcriptRef = useRef(null);
  const timerRef = useRef(null);
  const difyTimerRef = useRef(null);
  const difyAbortRef = useRef(null);
  const conversationIdRef = useRef("");
  const lastSentRef = useRef("");
  const aiPinnedRef = useRef(false);
  const aiEnabledRef = useRef(true);
  const recognitionRef = useRef(null);
  const restartAttemptsRef = useRef(0);
  const noSpeechCountRef = useRef(0);
  const interimRef = useRef(""); // 未確定テキスト保持（セッション切断時の救出用）
  const transcriptLinesRef = useRef([]); // onresultからtranscript参照用
  const manualFieldsRef = useRef(new Set()); // 手入力で編集されたフィールドを追跡
  const audioContextRef = useRef(null);
  const micStreamRef = useRef(null);
  const callActiveRef = useRef(false);
  const triggerStreamRef = useRef(null);
  const triggerContextRef = useRef(null);
  const triggerRafRef = useRef(null);
  const triggerCooldownRef = useRef(false);
  const startCallRef = useRef(null);

  // ── Whisper 録音用 ref（複数チャンネル対応: 0=operator, 1=customer）──
  const whisperStreamRef = useRef(null);
  const whisperContextRef = useRef(null);
  const whisperNodeRef = useRef(null);
  const whisperStream2Ref = useRef(null);
  const whisperContext2Ref = useRef(null);
  const whisperNode2Ref = useRef(null);

  // ── オーディオデバイスの列挙 ──
  useEffect(() => {
    async function enumerateDevices() {
      try {
        // 権限取得のために一度getUserMediaを呼ぶ（デバイスラベルが取得できるようになる）
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach(t => t.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === "audioinput");
        setAudioDevices(audioInputs);
      } catch {
        // マイク権限がない場合はデバイス列挙できないが、通常の認識は動く
        setAudioDevices([]);
      }
    }
    if (isLoggedIn) enumerateDevices();
  }, [isLoggedIn]);

  // ── デバイス設定の永続化 ──
  useEffect(() => {
    saveDeviceSettings({ operatorDeviceId, customerDeviceId, dualMode, triggerEnabled, triggerDeviceId });
  }, [operatorDeviceId, customerDeviceId, dualMode, triggerEnabled, triggerDeviceId]);

  // ── phone-watcher 連携: ポーリング（未起動時は頻度を下げる） ──
  useEffect(() => {
    if (!isLoggedIn) return;
    let timerId = null;
    let interval = 3000; // 初期: 3秒
    const poll = async () => {
      try {
        const res = await fetch("http://localhost:3456/latest-call");
        const data = await res.json();
        interval = 3000; // 接続成功 → 通常頻度に戻す
        if (data.phone && data.timestamp && data.timestamp !== lastPhoneTimestampRef.current) {
          lastPhoneTimestampRef.current = data.timestamp;
          setAppView("assist");
          if (!manualFieldsRef.current.has("callback_number")) {
            setEditableSummary(prev => ({ ...prev, callback_number: data.phone }));
          }
          fetch("http://localhost:3456/clear", { method: "POST" }).catch(() => {});
        }
      } catch {
        interval = 30000; // 接続失敗 → 30秒に減速
      }
      timerId = setTimeout(poll, interval);
    };
    timerId = setTimeout(poll, 3000);
    return () => clearTimeout(timerId);
  }, [isLoggedIn]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    if (callActive) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [callActive]);

  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  const callDifyAPI = useCallback(async (fullText, signal) => {
    if (!fullText.trim() || fullText === lastSentRef.current) return;
    lastSentRef.current = fullText;
    setAiLoading(true);
    setAiResponse("");

    try {
      const body = {
        inputs: {},
        query: `以下はお客様との通話内容です。この内容に基づいて、オペレーターが取るべき対応手順を簡潔に案内してください。\n\nまた、通話内容から以下の情報が判明した場合は、回答の末尾に次の形式で記載してください（不明な項目は省略）:\n[[INFO]]\n名前: （相手の名前）\n契約者名: （阿蘇光の契約者フルネーム）\n契約住所: （契約住所）\n[[/INFO]]\n\n通話内容:\n${fullText}`,
        response_mode: "streaming",
        user: "operator",
      };
      if (conversationIdRef.current) body.conversation_id = conversationIdRef.current;

      const res = await fetch(DIFY_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${DIFY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        if (res.status === 400) conversationIdRef.current = null;
        const detail = await res.text().catch(() => "");
        throw new Error(`API error: ${res.status}${detail ? ` — ${detail}` : ""}`);
      }

      // SSE ストリームを逐次読み取り
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop(); // 末尾の不完全行は次回へ持ち越す

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.event === "message") {
              accumulated += event.answer ?? "";
              // [[INFO]]ブロックが途中でストリームされていても非表示にしながら更新
              const display = accumulated
                .replace(/\[\[INFO\]\][\s\S]*?\[\[\/INFO\]\]/, "")
                .replace(/\[\[INFO\]\][\s\S]*$/, "") // 未閉じブロックも除去
                .trim();
              setAiResponse(display);
            } else if (event.event === "message_end") {
              if (event.conversation_id) conversationIdRef.current = event.conversation_id;
            }
          } catch {
            // 不完全な JSON は無視
          }
        }
      }

      // ストリーム完了後: [[INFO]]ブロックをフォームに反映
      const infoMatch = accumulated.match(/\[\[INFO\]\]([\s\S]*?)\[\[\/INFO\]\]/);
      if (infoMatch) {
        const info = infoMatch[1];
        const nameMatch = info.match(/名前:\s*(.+)/);
        const contractNameMatch = info.match(/契約者名:\s*(.+)/);
        const addressMatch = info.match(/契約住所:\s*(.+)/);
        setEditableSummary(prev => {
          const updated = { ...prev };
          if (nameMatch && nameMatch[1].trim() !== "不明" && !manualFieldsRef.current.has("caller_name")) {
            updated.caller_name = nameMatch[1].trim();
          }
          if (contractNameMatch && contractNameMatch[1].trim() !== "不明" && !manualFieldsRef.current.has("contract_name")) {
            updated.contract_name = contractNameMatch[1].trim();
          }
          if (addressMatch && addressMatch[1].trim() !== "不明" && !manualFieldsRef.current.has("contract_address")) {
            updated.contract_address = addressMatch[1].trim();
          }
          return updated;
        });
        setAiResponse(accumulated.replace(/\[\[INFO\]\][\s\S]*?\[\[\/INFO\]\]/, "").trim());
      } else if (!accumulated) {
        setAiResponse("回答を取得できませんでした。");
      }
    } catch (err) {
      if (err.name === "AbortError") return; // 新しいリクエストによるキャンセルは無視
      console.error("Dify API error:", err);
      setAiResponse("APIエラーが発生しました。接続を確認してください。");
    } finally {
      setAiLoading(false);
    }
  }, []);

  const summarizeCall = useCallback(async (lines) => {
    const fullText = lines.map(l => `[${l.ts}] ${l.text}`).join("\n");
    if (!fullText.trim()) return null;

    setSaveStatus("summarizing");
    try {
      const res = await fetch(DIFY_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${DIFY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: {},
          query: `以下の通話記録を分析して、JSON形式で要約してください。必ず以下のキーを含めてください：
- caller_name: お客様の名前（不明なら「不明」）
- category: 問い合わせカテゴリ（接続障害/速度低下/料金・請求/解約・退会/機器設定/その他）
- summary: 要件の要約（1〜2文）
- callback_needed: 折り返し連絡が必要か（true/false）
- callback_number: 折り返し先の電話番号（不明なら空文字）
- callback_reason: 折り返しが必要な場合その理由（不要なら空文字）
- urgency: 緊急度（高/中/低）
- action_items: 対応が必要な事項のリスト（配列）

JSON以外は出力しないでください。

通話記録:
${fullText}`,
          response_mode: "blocking",
          user: "operator",
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`API error: ${res.status}${detail ? ` — ${detail}` : ""}`);
      }
      const data = await res.json();
      const answer = data.answer || "";

      // JSONを抽出（```json ... ``` やプレーンJSON両方に対応）
      const jsonMatch = answer.match(/```json\s*([\s\S]*?)```/) || answer.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return parsed;
      }
      // パースできなかった場合はフォールバック
      return {
        caller_name: "不明",
        category: "その他",
        summary: lines.map(l => l.text).join(" "),
        callback_needed: false,
        callback_number: "",
        callback_reason: "",
        urgency: "中",
        action_items: [],
      };
    } catch (err) {
      console.error("Summary API error:", err);
      // APIエラー時もフォールバック要約を返す
      return {
        caller_name: "不明",
        category: "その他",
        summary: lines.map(l => l.text).join(" "),
        callback_needed: false,
        callback_number: "",
        callback_reason: "",
        urgency: "中",
        action_items: ["要約APIエラー — 手動確認が必要"],
      };
    }
  }, []);

  const saveToSpreadsheet = useCallback(async (data) => {
    if (!GAS_WEBHOOK_URL) {
      console.warn("GAS_WEBHOOK_URL が未設定です。");
      return false;
    }

    setSaveStatus("saving");
    try {
      // GASはCORSプリフライトに非対応のため、no-corsモードで送信
      // text/plainにすることでプリフライトを回避
      await fetch(GAS_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ ...data, api_key: GAS_API_KEY }),
      });
      // no-corsモードではレスポンスが不透明になるため、送信成功とみなす
      return true;
    } catch (err) {
      console.error("Spreadsheet save error:", err);
      return false;
    }
  }, []);

  const scheduleDifyCall = useCallback((lines, interim = "") => {
    if (!aiEnabledRef.current || testCallRunningRef.current) return;
    clearTimeout(difyTimerRef.current);
    const fullText = lines.map(l => {
      const label = l.speaker === "operator" ? "[OP]" : l.speaker === "customer" ? "[CU]" : "";
      return label ? `${label} ${l.text}` : l.text;
    }).join("\n") + (interim ? "\n" + interim : "");

    const isFinal = !interim;
    const delay = isFinal ? 0 : 200;

    difyTimerRef.current = setTimeout(() => {
      // 進行中のリクエストをキャンセルして新しいリクエストを開始
      difyAbortRef.current?.abort();
      const controller = new AbortController();
      difyAbortRef.current = controller;
      callDifyAPI(fullText, controller.signal);
    }, delay);
  }, [callDifyAPI]);

  const addLine = (text, speaker = "customer") => {
    // 電話番号をローカル即時抽出（手入力済みなら上書きしない）
    const phone = extractPhoneNumber(text);
    if (phone && !manualFieldsRef.current.has("callback_number")) {
      setEditableSummary(prev => prev.callback_number ? prev : { ...prev, callback_number: phone });
    }
    setTranscript(prev => {
      const lines = [...prev, {
        id: Date.now() + Math.random(),
        text,
        speaker,
        ts: new Date().toLocaleTimeString("ja-JP", {hour:"2-digit",minute:"2-digit",second:"2-digit"}),
      }];
      transcriptLinesRef.current = lines;
      const fullText = lines.map(l => l.text).join(" ");
      const found = searchKB(fullText);
      if (found.length > 0) {
        setAnimateResult(false);
        setTimeout(() => { setKbResults(found); setAnimateResult(true); }, 50);
      }
      scheduleDifyCall(lines);
      return lines;
    });
  };

  // ── iframe からの postMessage を処理 ──
  useEffect(() => {
    const handleWorkerMessage = (event) => {
      const data = event.data;
      if (!data || !data.type) return;

      const addDebug = (msg) => {
        if (!debugModeRef.current) return;
        const ts = new Date().toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
        setSpeechDebug(prev => [...prev.slice(-19), `${ts} ${msg}`]);
      };

      const speakerLabel = data.speaker === "operator" ? "OP" : "CU";

      switch (data.type) {
        case "result":
          if (data.isFinal) {
            addDebug(`📝 [${speakerLabel}] final: "${data.text}"`);
            if (data.speaker === "customer") {
              customerInterimRef.current = "";
            } else {
              interimRef.current = "";
            }
            setInterimText("");
            addLine(data.text, data.speaker);
          } else {
            addDebug(`... [${speakerLabel}] interim: "${data.text}"`);
            if (data.speaker === "customer") {
              customerInterimRef.current = data.text;
            } else {
              interimRef.current = data.text;
            }
            setInterimText(data.text);
            // interimでもKB検索+Dify APIを実行
            const found = searchKB(data.text);
            if (found.length > 0) {
              setAnimateResult(false);
              setTimeout(() => { setKbResults(found); setAnimateResult(true); }, 50);
            }
            scheduleDifyCall(transcriptLinesRef.current, data.text);
          }
          break;
        case "error":
          addDebug(`❌ [${speakerLabel}] ${data.error}`);
          if (data.fatal) {
            setSpeechError(`[${data.speaker === "operator" ? "オペレーター" : "お客様"}] ${data.error}`);
          }
          break;
        case "status":
          addDebug(`ℹ️ [${speakerLabel}] ${data.status}`);
          break;
      }
    };

    window.addEventListener("message", handleWorkerMessage);
    return () => window.removeEventListener("message", handleWorkerMessage);
  }, [scheduleDifyCall]);

  // ── シングルモード用: 従来のSpeechRecognition（iframeなし） ──
  const startSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError("このブラウザは音声認識に対応していません。Google Chromeをご利用ください。");
      setIsListening(false);
      return;
    }

    setSpeechError("");
    setInterimText("");
    setSpeechDebug([]);
    restartAttemptsRef.current = 0;
    noSpeechCountRef.current = 0;

    const addDebug = (msg) => {
      if (!debugModeRef.current) return;
      const ts = new Date().toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
      setSpeechDebug(prev => [...prev.slice(-19), `${ts} ${msg}`]);
    };

    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onaudiostart = () => addDebug("✅ audiostart — マイク音声取得開始");
    recognition.onaudioend = () => addDebug("⏹ audioend — マイク音声取得終了");
    recognition.onspeechstart = () => addDebug("✅ speechstart — 音声検出");
    recognition.onspeechend = () => addDebug("⏹ speechend — 音声終了");
    recognition.onstart = () => addDebug("✅ start — 認識サービス開始");

    recognition.onresult = (event) => {
      restartAttemptsRef.current = 0;
      noSpeechCountRef.current = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const finalText = normalizeAddress(event.results[i][0].transcript);
          addDebug(`📝 result(final): "${finalText}"`);
          interimRef.current = "";
          setInterimText("");
          addLine(finalText, "mixed");
        } else {
          const interim = normalizeAddress(event.results[i][0].transcript);
          addDebug(`... result(interim): "${interim}"`);
          interimRef.current = interim;
          setInterimText(interim);
          const found = searchKB(interim);
          if (found.length > 0) {
            setAnimateResult(false);
            setTimeout(() => { setKbResults(found); setAnimateResult(true); }, 50);
          }
          scheduleDifyCall(transcriptLinesRef.current, interim);
        }
      }
    };

    recognition.onerror = (event) => {
      addDebug(`❌ error: ${event.error}`);
      switch (event.error) {
        case "not-allowed":
          setSpeechError(
            "マイクへのアクセスが拒否されました。\n" +
            "① Chromeのアドレスバー左の鍵アイコン → マイクを「許可」\n" +
            "② macOS: システム設定 → プライバシーとセキュリティ → マイク → Chromeにチェック"
          );
          setIsListening(false);
          recognitionRef.current = null;
          break;
        case "audio-capture":
          setSpeechError(
            "マイクが検出されません。\n" +
            "macOS: システム設定 → サウンド → 入力で「MacBook Proのマイク」が選択されているか確認してください。"
          );
          setIsListening(false);
          recognitionRef.current = null;
          break;
        case "network":
          setSpeechError("音声認識サーバーに接続できません。ネットワーク接続を確認してください。");
          break;
        case "no-speech":
          noSpeechCountRef.current += 1;
          if (noSpeechCountRef.current >= 3) {
            setSpeechError(
              "マイクからの音声が検出されません。以下を確認してください：\n" +
              "① macOS: システム設定 → プライバシーとセキュリティ → マイク → Chromeが許可されているか\n" +
              "② macOS: システム設定 → サウンド → 入力 → 入力レベルが反応しているか\n" +
              "③ Chromeのタブがミュートされていないか"
            );
          }
          break;
        default:
          setSpeechError(`音声認識エラー: ${event.error}`);
          break;
      }
    };

    recognition.onend = () => {
      addDebug("⏹ end — 認識サービス終了");
      if (interimRef.current.trim()) {
        addDebug(`🛟 rescue interim: "${interimRef.current.trim()}"`);
        addLine(interimRef.current.trim(), "mixed");
        interimRef.current = "";
      }
      setInterimText("");
      if (recognitionRef.current) {
        restartAttemptsRef.current += 1;
        if (restartAttemptsRef.current > 30) {
          setSpeechError("音声認識が繰り返し停止しました。通話を終了して再度開始してください。");
          setIsListening(false);
          recognitionRef.current = null;
          return;
        }
        try {
          recognitionRef.current.start();
          addDebug(`🔄 restart (#${restartAttemptsRef.current})`);
        } catch {
          setSpeechError("音声認識の再開に失敗しました。");
          setIsListening(false);
          recognitionRef.current = null;
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      addDebug("🎙️ recognition.start() 呼び出し成功");
    } catch (err) {
      setSpeechError(`音声認識の開始に失敗しました: ${err.message}`);
      setIsListening(false);
      recognitionRef.current = null;
    }
  };

  // ── デュアルモード用: iframe経由の音声認識を開始 ──
  const startDualSpeechRecognition = () => {
    setSpeechError("");
    setInterimText("");
    setSpeechDebug([]);

    const basePath = import.meta.env.BASE_URL || "/";
    const workerUrl = `${basePath}speech-worker.html`;

    // オペレーター用iframe
    const opIframe = document.createElement("iframe");
    opIframe.src = workerUrl;
    opIframe.style.display = "none";
    opIframe.setAttribute("allow", "microphone");
    document.body.appendChild(opIframe);
    operatorIframeRef.current = opIframe;

    opIframe.onload = () => {
      opIframe.contentWindow.postMessage({
        type: "start",
        deviceId: operatorDeviceId || "",
        speaker: "operator",
        lang: "ja-JP",
      }, "*");
    };

    // お客様用iframe
    const cuIframe = document.createElement("iframe");
    cuIframe.src = workerUrl;
    cuIframe.style.display = "none";
    cuIframe.setAttribute("allow", "microphone");
    document.body.appendChild(cuIframe);
    customerIframeRef.current = cuIframe;

    cuIframe.onload = () => {
      cuIframe.contentWindow.postMessage({
        type: "start",
        deviceId: customerDeviceId || "",
        speaker: "customer",
        lang: "ja-JP",
      }, "*");
    };
  };

  const stopSpeechRecognition = () => {
    // 通話終了時は onend の rescue に任せるため interimRef はここではクリアしない
    if (recognitionRef.current) {
      const ref = recognitionRef.current;
      recognitionRef.current = null;
      ref.stop();
    }
  };

  const stopDualSpeechRecognition = () => {
    [operatorIframeRef, customerIframeRef].forEach(ref => {
      if (ref.current) {
        try {
          ref.current.contentWindow.postMessage({ type: "stop" }, "*");
        } catch { /* ignore */ }
        ref.current.remove();
        ref.current = null;
      }
    });
  };

  const startMicMonitor = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const update = () => {
        if (!micStreamRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setMicLevel(Math.min(100, Math.round(avg * 1.5)));
        requestAnimationFrame(update);
      };
      update();
    } catch {
      setMicLevel(-1);
    }
  };

  const stopMicMonitor = () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setMicLevel(0);
  };

  // ── Whisper ローカル文字起こし（Electron 専用） ──
  // speaker: "operator" | "customer" | "mixed"
  // refs: { stream, ctx, node } を書き込む ref セット
  const startWhisperCapture = async (deviceId, speaker, refs) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    refs.stream.current = stream;

    const audioCtx = new AudioContext();
    refs.ctx.current = audioCtx;

    const processorUrl = `${import.meta.env.BASE_URL}audio-capture-processor.js`;
    await audioCtx.audioWorklet.addModule(processorUrl);

    const source = audioCtx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioCtx, "audio-capture-processor", {
      processorOptions: { sampleRate: audioCtx.sampleRate },
    });

    workletNode.port.onmessage = async (event) => {
      if (event.data.type !== "chunk" || !callActiveRef.current) return;
      try {
        const resampled = await resampleTo16k(event.data.samples, audioCtx.sampleRate);
        const result = await window.electronAPI.transcribe(resampled.buffer);
        if (result?.text?.trim()) {
          addLine(normalizeAddress(result.text.trim()), speaker);
          scheduleDifyCall(transcriptLinesRef.current, "");
        }
        if (result?.error) console.warn(`[whisper:${speaker}] エラー:`, result.error);
      } catch (err) {
        console.error(`[whisper:${speaker}] チャンク処理エラー:`, err);
      }
    };

    // 会話音声帯域（80Hz〜8kHz）のみ通過させるフィルタ
    // 低周波ノイズ（エアコン・振動）と高周波ノイズ（電子音）をカット
    const highpass = audioCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;

    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 8000;

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(workletNode);
    refs.node.current = workletNode;
  };

  const startWhisperRecording = async () => {
    setSpeechError("");
    try {
      const opRefs = { stream: whisperStreamRef, ctx: whisperContextRef, node: whisperNodeRef };
      await startWhisperCapture(operatorDeviceId || "", "operator", opRefs);

      if (dualMode && customerDeviceId) {
        const cuRefs = { stream: whisperStream2Ref, ctx: whisperContext2Ref, node: whisperNode2Ref };
        await startWhisperCapture(customerDeviceId, "customer", cuRefs);
      }
    } catch (err) {
      setSpeechError(`Whisper マイクエラー: ${err.message}`);
      setIsListening(false);
    }
  };

  const stopWhisperChannel = (refs) => {
    if (refs.node.current) {
      refs.node.current.port.postMessage({ type: "stop" });
      refs.node.current.disconnect();
      refs.node.current = null;
    }
    if (refs.stream.current) {
      refs.stream.current.getTracks().forEach(t => t.stop());
      refs.stream.current = null;
    }
    if (refs.ctx.current) {
      refs.ctx.current.close();
      refs.ctx.current = null;
    }
  };

  const stopWhisperRecording = () => {
    stopWhisperChannel({ stream: whisperStreamRef, ctx: whisperContextRef, node: whisperNodeRef });
    stopWhisperChannel({ stream: whisperStream2Ref, ctx: whisperContext2Ref, node: whisperNode2Ref });
  };

  // ── VB-Audio トリガー監視 ──
  const stopTriggerMonitor = () => {
    if (triggerRafRef.current) {
      cancelAnimationFrame(triggerRafRef.current);
      triggerRafRef.current = null;
    }
    if (triggerStreamRef.current) {
      triggerStreamRef.current.getTracks().forEach(t => t.stop());
      triggerStreamRef.current = null;
    }
    if (triggerContextRef.current) {
      triggerContextRef.current.close();
      triggerContextRef.current = null;
    }
  };

  const startTriggerMonitor = async (deviceId) => {
    stopTriggerMonitor();
    try {
      const constraints = deviceId
        ? { audio: { deviceId: { exact: deviceId } } }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      triggerStreamRef.current = stream;

      const audioCtx = new AudioContext();
      triggerContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      // 平均振幅が15/255（≒-24dBFS相当）を超えたら通話開始とみなす
      const TRIGGER_THRESHOLD = 15;

      const check = () => {
        if (!triggerStreamRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        if (avg > TRIGGER_THRESHOLD && !callActiveRef.current && !triggerCooldownRef.current) {
          triggerCooldownRef.current = true;
          startCallRef.current?.();
          // 通話終了後の誤再トリガーを防ぐため10秒クールダウン
          setTimeout(() => { triggerCooldownRef.current = false; }, 10000);
        }
        triggerRafRef.current = requestAnimationFrame(check);
      };
      check();
    } catch (err) {
      console.error("[trigger] デバイス取得エラー:", err);
    }
  };

  // triggerEnabled / triggerDeviceId が変わったら監視を再起動
  useEffect(() => {
    if (isLoggedIn && triggerEnabled && triggerDeviceId) {
      startTriggerMonitor(triggerDeviceId);
    } else {
      stopTriggerMonitor();
    }
    return () => stopTriggerMonitor();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, triggerEnabled, triggerDeviceId]);

  // ── F2キーで通話開始/終了トグル ──────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        if (testCallRunningRef.current) return; // テストコール中はF2無効
        if (callActiveRef.current) {
          endCall();
        } else {
          startCall();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleDebug = () => {
    const next = !debugMode;
    setDebugMode(next);
    debugModeRef.current = next;
    if (next) {
      setSpeechDebug([]);
      if (callActive) startMicMonitor();
    } else {
      stopMicMonitor();
      setSpeechDebug([]);
    }
  };

  const startCall = () => {
    setCallActive(true);
    callActiveRef.current = true;
    setIsListening(true);
    setTranscript([]);
    setKbResults([]);
    setAiResponse("");
    setSpeechError("");
    setEditableSummary({
      timestamp: new Date().toLocaleString("ja-JP"),
      caller_name: "",
      category: "",
      summary: "",
      callback_number: "",
      contract_name: "",
      contract_address: "",
      callback_assignee: "",
      operator: operatorName,
    });
    manualFieldsRef.current = new Set();
    conversationIdRef.current = "";
    lastSentRef.current = "";
    if (isElectron) {
      // Electron: whisper.cpp によるローカル文字起こし
      startWhisperRecording();
    } else if (dualMode && customerDeviceId) {
      startDualSpeechRecognition();
    } else {
      startSpeechRecognition();
    }
    if (debugModeRef.current) startMicMonitor();
  };
  // startCall を常に最新版に保つ（トリガー監視ループから呼び出し用）
  startCallRef.current = startCall;

  const endCall = async () => {
    const currentTranscript = [...transcript];

    setCallActive(false);
    callActiveRef.current = false;
    setIsListening(false);
    setSpeechError("");
    setInterimText("");
    stopMicMonitor();
    clearTimeout(difyTimerRef.current);
    stopSpeechRecognition();
    stopDualSpeechRecognition();
    stopWhisperRecording();

    if (currentTranscript.length === 0) return;

    // 通話要約を生成し、手入力されていないフィールドのみ自動入力
    const summary = await summarizeCall(currentTranscript);
    if (summary) {
      setCallSummary(summary);
      setEditableSummary(prev => ({
        ...prev,
        caller_name: manualFieldsRef.current.has("caller_name") ? prev.caller_name : (prev.caller_name || summary.caller_name || "不明"),
        category: manualFieldsRef.current.has("category") ? prev.category : (summary.category || prev.category || "その他"),
        summary: manualFieldsRef.current.has("summary") ? prev.summary : (summary.summary || ""),
        callback_number: manualFieldsRef.current.has("callback_number") ? prev.callback_number : (prev.callback_number || summary.callback_number || ""),
        contract_name: manualFieldsRef.current.has("contract_name") ? prev.contract_name : (prev.contract_name || ""),
        contract_address: manualFieldsRef.current.has("contract_address") ? prev.contract_address : (prev.contract_address || ""),
      }));
      setSaveStatus("");
      setShowSummaryModal(true);
    }
  };

  const handleSaveSummary = async () => {
    const dataToSave = { ...editableSummary };
    // 折り返し担当者が指定されている場合、内容の先頭に「要折返TEL：〇〇」を付与
    if (dataToSave.callback_assignee) {
      const prefix = `要折返TEL：${dataToSave.callback_assignee}`;
      if (!dataToSave.summary.startsWith("要折返")) {
        dataToSave.summary = `${prefix}\n${dataToSave.summary}`;
      }
    }
    // 話者付き会話ログを付与
    if (transcript.length > 0) {
      dataToSave.conversation_log = transcript.map(l => {
        const label = l.speaker === "operator" ? "[OP]" : l.speaker === "customer" ? "[CU]" : "";
        return label ? `${l.ts} ${label} ${l.text}` : `${l.ts} ${l.text}`;
      }).join("\n");
    }
    const saved = await saveToSpreadsheet(dataToSave);
    setSaveStatus(saved ? "saved" : (GAS_WEBHOOK_URL ? "error" : "saved"));
    if (saved || !GAS_WEBHOOK_URL) {
      setTimeout(() => setShowSummaryModal(false), 1200);
    }
  };

  const handleEditField = (field, value) => {
    manualFieldsRef.current.add(field);
    setEditableSummary(prev => ({ ...prev, [field]: value }));
  };

  const handleLogin = () => {
    const name = loginInput.trim();
    if (!name) return;
    saveSession(name);
    setOperatorName(name);
    setLoginInput("");
  };

  const handleLogout = () => {
    clearSession();
    setOperatorName("");
  };

  const handleManualSearch = () => {
    if (!inputText.trim()) return;
    addLine(inputText.trim());
    setInputText("");
  };

  // ── テストコール（デモ用） ──
  const [testCallRunning, setTestCallRunning] = useState(false);
  const testCallRunningRef = useRef(false);
  const testCallAbortRef = useRef(false);

  const runTestCall = async () => {
    if (callActive || testCallRunning) return;
    setTestCallRunning(true);
    testCallRunningRef.current = true;
    testCallAbortRef.current = false;

    try {
      // 初期化（残留タイマー・リクエストをキャンセル）
      clearTimeout(difyTimerRef.current);
      difyAbortRef.current?.abort();
      setAppView("assist");
      setTranscript([]);
      transcriptLinesRef.current = [];
      setKbResults([]);
      setAiResponse("");
      setPinnedAiResponse("");
      aiPinnedRef.current = false;
      conversationIdRef.current = "";
      lastSentRef.current = "";
      manualFieldsRef.current = new Set();
      setSpeechError("");
      setInterimText("");
      setAiLoading(false);
      setCallActive(true);
      callActiveRef.current = true;
      setIsListening(true);
      setEditableSummary({
        timestamp: new Date().toLocaleString("ja-JP"),
        caller_name: "", category: "", summary: "",
        callback_number: "", contract_name: "", contract_address: "",
        callback_assignee: "", operator: operatorName,
      });

      const testScript = [
        { speaker: "operator", text: "お電話ありがとうございます。阿蘇ネットサポートセンターです。" },
        { speaker: "customer", text: "すみません、インターネットが繋がらなくなったんですけど。" },
        { speaker: "operator", text: "ご不便をおかけして申し訳ございません。状況を確認いたします。ONUのランプはどのような状態ですか？" },
        { speaker: "customer", text: "赤いランプが点滅しています。名前は山田太郎です。" },
        { speaker: "operator", text: "かしこまりました。山田太郎様ですね。電話番号を確認してよろしいですか？" },
        { speaker: "customer", text: "はい、0967-34-1234です。住所は熊本県阿蘇市内牧1234番地です。" },
        { speaker: "operator", text: "ありがとうございます。機器の再起動をご案内いたします。改善しない場合は折り返しご連絡いたします。" },
        { speaker: "customer", text: "わかりました。折り返しは佐藤さんにお願いしたいのですが。" },
        { speaker: "operator", text: "かしこまりました。佐藤が折り返しご連絡いたします。しばらくお待ちください。" },
      ];

      const delay = (ms) => new Promise(r => setTimeout(r, ms));

      for (const line of testScript) {
        if (testCallAbortRef.current) break;
        await delay(1800);
        if (testCallAbortRef.current) break;
        addLine(line.text, line.speaker);
      }

      if (!testCallAbortRef.current) {
        await delay(1500);
        // 通話終了 → 要約をシミュレート
        setCallActive(false);
        callActiveRef.current = false;
        setIsListening(false);

        // テスト用の要約を直接設定
        setEditableSummary(prev => ({
          ...prev,
          caller_name: prev.caller_name || "山田太郎",
          category: prev.category || "接続障害",
          summary: prev.summary || "要折返TEL：佐藤\nONUの赤ランプ点滅でインターネット接続不可。再起動案内済み。改善なければ折り返し対応。",
          callback_number: prev.callback_number || "0967341234",
          contract_name: prev.contract_name || "山田太郎",
          contract_address: prev.contract_address || "熊本県阿蘇市内牧1234番地",
          callback_assignee: prev.callback_assignee || "佐藤",
        }));
        setSaveStatus("");
        setShowSummaryModal(true);

        // 3秒後に電話応対マネージャーに切り替え
        await delay(3000);
        if (!testCallAbortRef.current) {
          setAppView("manager");
        }
      } else {
        setCallActive(false);
        callActiveRef.current = false;
        setIsListening(false);
      }
    } catch (err) {
      console.error("テストコールエラー:", err);
      setCallActive(false);
      callActiveRef.current = false;
      setIsListening(false);
    }

    setTestCallRunning(false);
    testCallRunningRef.current = false;
  };

  const stopTestCall = () => {
    testCallAbortRef.current = true;
    setCallActive(false);
    callActiveRef.current = false;
    setIsListening(false);
    setTestCallRunning(false);
    testCallRunningRef.current = false;
  };

  if (!isLoggedIn) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#2a2d35",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
        color: "#e0e2e6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <div style={{
          background: "#32363e",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 20,
          padding: "48px 40px",
          width: "100%",
          maxWidth: 380,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          textAlign: "center",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "linear-gradient(135deg, #5c6bc0, #3f51b5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, margin: "0 auto 20px",
          }}>📞</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#5c6bc0", letterSpacing: "0.08em", marginBottom: 6 }}>
            ASO NET
          </div>
          <div style={{ fontSize: 11, color: "#9a9da4", letterSpacing: "0.05em", marginBottom: 32 }}>
            OPERATOR ASSIST SYSTEM
          </div>

          <div style={{ textAlign: "left", marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "#9a9da4", letterSpacing: "0.08em" }}>
              オペレーター名
            </label>
          </div>
          <input
            value={loginInput}
            onChange={e => setLoginInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            placeholder="名前を入力してください"
            autoFocus
            style={{
              width: "100%",
              background: "#3a3f48",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              padding: "12px 16px",
              color: "#e0e2e6",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 20,
            }}
          />
          <button
            onClick={handleLogin}
            disabled={!loginInput.trim()}
            style={{
              width: "100%",
              background: loginInput.trim()
                ? "linear-gradient(135deg, #5c6bc0, #3f51b5)"
                : "#3a3f48",
              border: "none",
              borderRadius: 10,
              padding: "12px 20px",
              color: loginInput.trim() ? "#ffffff" : "#9a9da4",
              fontSize: 14,
              fontWeight: 700,
              cursor: loginInput.trim() ? "pointer" : "default",
              letterSpacing: "0.05em",
              transition: "all 0.2s",
            }}
          >
            ログイン
          </button>
          <div style={{ fontSize: 10, color: "#6a6d74", marginTop: 16 }}>
            ログイン状態は6時間保持されます
          </div>
        </div>
        <style>{`
          input::placeholder { color: #6a6d74; }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      height: "100vh",
      background: "#2a2d35",
      fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      color: "#e0e2e6",
      display: "flex",
      flexDirection: "column",
      paddingBottom: appView === "assist" ? 60 : 0,
      overflow: "hidden",
    }}>
      {/* Header */}
      <header style={{
        background: "#32363e",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "0 24px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg, #5c6bc0, #3f51b5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16,
            }}>📞</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: "#5c6bc0" }}>
                ASO NET
              </div>
              <div style={{ fontSize: 10, color: "#9a9da4", letterSpacing: "0.05em" }}>
                NETWORK SUPPORT SYSTEM
              </div>
            </div>
          </div>
          {/* App Switcher */}
          <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: 3 }}>
            <button onClick={() => setAppView("assist")} style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background: appView === "assist" ? "rgba(92,107,192,0.2)" : "transparent",
              color: appView === "assist" ? "#5c6bc0" : "#9a9da4",
            }}>オペレーターアシスト</button>
            <button onClick={() => setAppView("manager")} style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background: appView === "manager" ? "rgba(92,107,192,0.2)" : "transparent",
              color: appView === "manager" ? "#5c6bc0" : "#9a9da4",
            }}>電話応対マネージャー</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {callActive && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: "#4caf50",
                boxShadow: "0 0 0 3px rgba(76,175,80,0.3)",
                animation: "pulse 1.5s infinite",
                display: "inline-block",
              }}/>
              <span style={{ fontSize: 12, color: "#4caf50", fontVariantNumeric: "tabular-nums" }}>
                通話中 {fmt(elapsed)}
              </span>
            </div>
          )}
          <div style={{ fontSize: 11, color: "#9a9da4" }}>
            {new Date().toLocaleDateString("ja-JP", { year:"numeric", month:"long", day:"numeric", weekday:"short" })}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            borderLeft: "1px solid rgba(255,255,255,0.08)",
            paddingLeft: 16,
          }}>
            <span style={{ fontSize: 12, color: "#e0e2e6" }}>{operatorName}</span>
            <button onClick={handleLogout} style={{
              background: "#3a3f48",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "3px 10px",
              color: "#9a9da4",
              fontSize: 10,
              cursor: "pointer",
            }}>ログアウト</button>
          </div>
        </div>
      </header>

      {/* Manager View — 常時保持、display切替で瞬時表示 */}
      <div style={{ flex: 1, overflow: "hidden", display: appView === "manager" ? "block" : "none" }}>
        <iframe
          src={`https://asotwc.org/call-m/?operator=${encodeURIComponent(operatorName)}`}
          style={{ width: "100%", height: "100%", border: "none", background: "#2a2d35" }}
          title="TWC電話応対マネージャー"
        />
      </div>

      {/* Assist View */}
      {appView === "assist" && (<>
      <div style={{ flex: 1, display: "flex", overflow: "hidden", gap: 0 }}>

        {/* Left: Transcript Panel */}
        <div style={{
          width: "25%",
          minWidth: 260,
          borderRight: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexDirection: "column",
          background: "#32363e",
        }}>
          <div style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#9a9da4" }}>
              ▌ 通話テキスト
            </div>
            {isListening && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#ef5350",
                  animation: "blink 1s infinite",
                  display: "inline-block",
                }}/>
                <span style={{ fontSize: 10, color: "#ef5350", letterSpacing: "0.08em" }}>
                  音声認識中
                </span>
              </div>
            )}
          </div>

          {speechError && (
            <div style={{
              margin: "0 16px",
              padding: "8px 12px",
              background: "rgba(239,83,80,0.1)",
              border: "1px solid rgba(239,83,80,0.3)",
              borderRadius: 8,
              fontSize: 12,
              color: "#ef5350",
              lineHeight: 1.6,
            }}>
              ⚠ {speechError.split("\n").map((line, i) => (
                <span key={i}>{i > 0 && <br/>}{line}</span>
              ))}
            </div>
          )}

          {debugMode && callActive && (
            <div style={{
              margin: "8px 16px 0",
              padding: "8px 10px",
              background: "rgba(100,181,246,0.08)",
              border: "1px solid rgba(100,181,246,0.15)",
              borderRadius: 8,
              fontSize: 10,
              fontFamily: "monospace",
              color: "#64b5f6",
              lineHeight: 1.6,
              maxHeight: 160,
              overflowY: "auto",
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>🔍 音声認識デバッグ</div>

              {/* Mic Level Meter */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span>🎤 Chrome入力レベル:</span>
                {micLevel === -1 ? (
                  <span style={{ color: "#ef5350" }}>マイク取得失敗</span>
                ) : (
                  <>
                    <div style={{
                      flex: 1,
                      height: 8,
                      background: "rgba(255,255,255,0.08)",
                      borderRadius: 4,
                      overflow: "hidden",
                      maxWidth: 150,
                    }}>
                      <div style={{
                        height: "100%",
                        width: `${micLevel}%`,
                        background: micLevel > 30 ? "#4caf50" : micLevel > 5 ? "#ffb74d" : "#ef5350",
                        borderRadius: 4,
                        transition: "width 0.1s",
                      }}/>
                    </div>
                    <span>{micLevel}%</span>
                    {micLevel <= 5 && (
                      <span style={{ color: "#ef5350" }}>⚠ 無音</span>
                    )}
                  </>
                )}
              </div>

              {speechDebug.map((msg, i) => (
                <div key={i}>{msg}</div>
              ))}
            </div>
          )}

          <div ref={transcriptRef} style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
          }}>
            {transcript.length === 0 && !interimText ? (
              <div style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                opacity: 0.35,
              }}>
                <div style={{ fontSize: 32 }}>🎙️</div>
                <div style={{ fontSize: 12, textAlign: "center", lineHeight: 1.8 }}>
                  通話開始でリアルタイムに<br/>テキストが表示されます
                </div>
              </div>
            ) : (
              <>
                {transcript.map((line) => {
                  const isOp = line.speaker === "operator";
                  const isCu = line.speaker === "customer";
                  const isMixed = line.speaker === "mixed";
                  const speakerColor = isOp ? "#64b5f6" : isCu ? "#5c6bc0" : "#e0e2e6";
                  const speakerName = isOp ? "オペレーター" : isCu ? "お客様" : "通話音声";
                  return (
                    <div key={line.id} style={{
                      marginBottom: 14,
                      animation: "fadeSlideIn 0.3s ease",
                    }}>
                      <div style={{ fontSize: 10, color: "#9a9da4", marginBottom: 4 }}>
                        {line.ts} — <span style={{ color: speakerColor }}>{speakerName}</span>
                      </div>
                      <div style={{
                        background: isOp ? "rgba(100,181,246,0.08)" : isCu ? "rgba(255,183,77,0.08)" : "rgba(255,255,255,0.03)",
                        border: isOp ? "1px solid rgba(100,181,246,0.15)" : isCu ? "1px solid rgba(255,183,77,0.15)" : "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 10,
                        padding: "10px 14px",
                        fontSize: 14,
                        lineHeight: 1.7,
                        color: "#e0e2e6",
                        borderLeft: isMixed ? "none" : isOp ? "3px solid rgba(100,181,246,0.4)" : "3px solid rgba(255,183,77,0.4)",
                      }}>
                        {line.text}
                      </div>
                    </div>
                  );
                })}
                {interimText && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: "#9a9da4", marginBottom: 4 }}>
                      認識中...
                    </div>
                    <div style={{
                      background: "rgba(92,107,192,0.06)",
                      border: "1px dashed rgba(92,107,192,0.2)",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontSize: 14,
                      lineHeight: 1.7,
                      color: "#9a9da4",
                      fontStyle: "italic",
                    }}>
                      {interimText}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Manual Input */}
          <div style={{
            padding: "12px 16px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ fontSize: 10, color: "#9a9da4", marginBottom: 8, letterSpacing: "0.08em" }}>
              ▌ キーワード手動入力
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleManualSearch()}
                placeholder="例：速度が遅い、接続できない…"
                style={{
                  flex: 1,
                  background: "#3a3f48",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#e0e2e6",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <button
                onClick={handleManualSearch}
                style={{
                  background: "rgba(92,107,192,0.15)",
                  border: "1px solid rgba(92,107,192,0.3)",
                  borderRadius: 8,
                  color: "#5c6bc0",
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >送信</button>
            </div>
          </div>
        </div>

        {/* Center: AI Guide Panel */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          background: "#32363e",
        }}>
          <div style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#9a9da4" }}>
              ▌ AIアシスト — 対応ガイド
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {kbResults.length > 0 && kbResults.map((r, i) => (
                <span key={i} style={{
                  background: i === 0 ? "rgba(92,107,192,0.15)" : "#3a3f48",
                  border: i === 0 ? "1px solid rgba(92,107,192,0.3)" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 20,
                  padding: "3px 12px",
                  fontSize: 11,
                  color: i === 0 ? "#5c6bc0" : "#9a9da4",
                  fontWeight: 700,
                }}>
                  {r.category}
                </span>
              ))}
              {aiLoading && aiEnabled && (
                <span style={{ fontSize: 10, color: "#64b5f6", animation: "blink 1s infinite" }}>
                  AI分析中...
                </span>
              )}
              <button
                onClick={() => {
                  const next = !aiEnabled;
                  setAiEnabled(next);
                  aiEnabledRef.current = next;
                  if (!next) {
                    // 停止時: 進行中リクエストをキャンセル
                    clearTimeout(difyTimerRef.current);
                    difyAbortRef.current?.abort();
                    setAiLoading(false);
                  }
                }}
                title={aiEnabled ? "AI回答を停止" : "AI回答を再開"}
                style={{
                  background: aiEnabled ? "rgba(239,83,80,0.1)" : "rgba(76,175,80,0.1)",
                  border: aiEnabled ? "1px solid rgba(239,83,80,0.3)" : "1px solid rgba(76,175,80,0.3)",
                  borderRadius: 6,
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  color: aiEnabled ? "#ef5350" : "#4caf50",
                }}
              >
                {aiEnabled ? "⏹ 停止" : "▶ 再開"}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {kbResults.length === 0 && !aiResponse ? (
              <div style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                opacity: 0.3,
              }}>
                <div style={{ fontSize: 40 }}>🔍</div>
                <div style={{ fontSize: 12, textAlign: "center", lineHeight: 2 }}>
                  通話内容を認識すると<br/>ここに対応ガイドが自動表示されます
                </div>
              </div>
            ) : (
              <div>
                {/* KB Quick Results — 最上位1件のみコンパクト表示 */}
                {kbResults.length > 0 && (
                  <div style={{
                    animation: animateResult ? "fadeSlideIn 0.4s ease" : "none",
                    marginBottom: 16,
                    background: "rgba(92,107,192,0.06)",
                    border: "1px solid rgba(92,107,192,0.15)",
                    borderRadius: 10,
                    padding: "10px 14px",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#5c6bc0", marginBottom: 8 }}>
                      クイックガイド — {kbResults[0].category}
                    </div>
                    {kbResults[0].steps.map((step, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 10, color: "#5c6bc0", fontWeight: 700, minWidth: 14, paddingTop: 2 }}>
                          {i + 1}.
                        </span>
                        <span style={{ fontSize: 12, color: "#c0c3ca", lineHeight: 1.6 }}>{step}</span>
                      </div>
                    ))}
                    {kbResults[0].tip && (
                      <div style={{ fontSize: 11, color: "#64b5f6", marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        💡 {kbResults[0].tip}
                      </div>
                    )}
                  </div>
                )}

                {/* AI Response from Dify */}
                {(aiResponse || aiLoading || pinnedAiResponse) && (
                  <div style={{
                    background: pinnedAiResponse ? "rgba(100,181,246,0.06)" : "rgba(76,175,80,0.06)",
                    border: pinnedAiResponse ? "1px solid rgba(100,181,246,0.2)" : "1px solid rgba(76,175,80,0.15)",
                    borderRadius: 14,
                    padding: "18px 20px",
                    animation: "fadeSlideIn 0.4s ease",
                  }}>
                    <div style={{
                      fontSize: 11, color: pinnedAiResponse ? "#64b5f6" : "#4caf50", fontWeight: 700,
                      letterSpacing: "0.1em", marginBottom: 12,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <span>🤖</span>
                      <span>AI ナレッジ回答</span>
                      {pinnedAiResponse && (
                        <span style={{ fontSize: 10, color: "#64b5f6", background: "rgba(100,181,246,0.1)", border: "1px solid rgba(100,181,246,0.2)", borderRadius: 10, padding: "1px 7px" }}>
                          ピン留め中
                        </span>
                      )}
                      <button
                        onClick={() => {
                          if (pinnedAiResponse) {
                            // ピン解除
                            aiPinnedRef.current = false;
                            setPinnedAiResponse("");
                          } else {
                            // 現在の回答をピン留め
                            aiPinnedRef.current = true;
                            setPinnedAiResponse(aiResponse);
                          }
                        }}
                        title={pinnedAiResponse ? "ピンを解除" : "この回答をピン留め"}
                        style={{
                          marginLeft: "auto",
                          background: pinnedAiResponse ? "rgba(100,181,246,0.1)" : "#3a3f48",
                          border: pinnedAiResponse ? "1px solid rgba(100,181,246,0.3)" : "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 8,
                          padding: "6px 12px",
                          cursor: "pointer",
                          fontSize: 16,
                          lineHeight: 1,
                        }}
                      >
                        {pinnedAiResponse ? "📌" : "📍"}
                      </button>
                    </div>
                    {aiLoading && !aiResponse ? (
                      kbResults.length > 0 ? (
                        // KB結果を先行表示（Dify回答待ちの間の即時ガイド）
                        <div style={{ animation: "fadeSlideIn 0.3s ease" }}>
                          <div style={{ fontSize: 11, color: "#9a9da4", marginBottom: 10 }}>
                            キーワード一致による暫定ガイド（AI分析中...）
                          </div>
                          {kbResults[0].steps.map((step, i) => (
                            <div key={i} style={{
                              display: "flex", gap: 10, marginBottom: 8,
                              animation: `fadeSlideIn 0.25s ease ${i * 0.06}s both`,
                            }}>
                              <div style={{
                                width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                                background: "rgba(76,175,80,0.12)", border: "1px solid rgba(76,175,80,0.3)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 10, fontWeight: 800, color: "#4caf50",
                              }}>
                                {i + 1}
                              </div>
                              <div style={{ fontSize: 13, lineHeight: 1.7, color: "#c0c3ca" }}>
                                {step}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: "#9a9da4", animation: "blink 1s infinite" }}>
                          ナレッジを検索中...
                        </div>
                      )
                    ) : (
                      <div>
                        {/* ピン留め中の回答 */}
                        <div style={{
                          fontSize: 14,
                          lineHeight: 2,
                          color: "#e0e2e6",
                          whiteSpace: "pre-wrap",
                        }}>
                          {pinnedAiResponse || aiResponse}
                        </div>
                        {/* ピン中かつ新しい回答がある場合は下に並べて表示 */}
                        {pinnedAiResponse && aiResponse && aiResponse !== pinnedAiResponse && (
                          <div style={{
                            marginTop: 14,
                            paddingTop: 14,
                            borderTop: "1px dashed rgba(255,255,255,0.1)",
                          }}>
                            <div style={{ fontSize: 10, color: "#9a9da4", letterSpacing: "0.08em", marginBottom: 8 }}>
                              最新の回答
                            </div>
                            <div style={{
                              fontSize: 14,
                              lineHeight: 2,
                              color: "#b0b3ba",
                              whiteSpace: "pre-wrap",
                            }}>
                              {aiResponse}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Record Form Panel */}
        <div style={{
          width: "25%",
          minWidth: 260,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#32363e",
        }}>
          <div style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#9a9da4" }}>
              ▌ 通話記録
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {[
              { key: "caller_name", label: "名前", icon: "👤" },
              { key: "callback_number", label: "電話番号", icon: "📞" },
              { key: "contract_name", label: "契約者名", icon: "📋" },
              { key: "contract_address", label: "契約住所", icon: "🏠" },
              { key: "category", label: "カテゴリー", icon: "📂", type: "select",
                options: ["","接続障害","速度低下","料金・請求","解約・退会","機器設定","その他"] },
              { key: "callback_assignee", label: "折返担当者", icon: "🔄" },
              { key: "summary", label: "内容", icon: "📝", multiline: true },
            ].map(({ key, label, icon, type, options, multiline }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{
                  fontSize: 10,
                  color: "#9a9da4",
                  letterSpacing: "0.05em",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  marginBottom: 4,
                }}>
                  <span>{icon}</span> {label}
                  {manualFieldsRef.current.has(key) && (
                    <span style={{ fontSize: 8, color: "#4caf50", marginLeft: 4 }}>手入力</span>
                  )}
                </label>
                {type === "select" ? (
                  <select
                    value={editableSummary[key]}
                    onChange={e => handleEditField(key, e.target.value)}
                    style={{
                      width: "100%",
                      background: "#3a3f48",
                      border: editableSummary[key] ? "1px solid rgba(76,175,80,0.3)" : "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 6,
                      padding: "7px 10px",
                      color: "#e0e2e6",
                      fontSize: 12,
                      outline: "none",
                      appearance: "none",
                    }}
                  >
                    {options.map(o => <option key={o} value={o} style={{ background: "#32363e" }}>{o || "（未選択）"}</option>)}
                  </select>
                ) : multiline ? (
                  <textarea
                    value={editableSummary[key]}
                    onChange={e => handleEditField(key, e.target.value)}
                    rows={3}
                    placeholder={key === "summary" ? "通話終了時に自動要約されます" : ""}
                    style={{
                      width: "100%",
                      background: "#3a3f48",
                      border: editableSummary[key] ? "1px solid rgba(76,175,80,0.3)" : "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 6,
                      padding: "7px 10px",
                      color: "#e0e2e6",
                      fontSize: 12,
                      lineHeight: 1.7,
                      outline: "none",
                      resize: "vertical",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                ) : (
                  <input
                    value={editableSummary[key]}
                    onChange={e => handleEditField(key, e.target.value)}
                    style={{
                      width: "100%",
                      background: "#3a3f48",
                      border: editableSummary[key] ? "1px solid rgba(76,175,80,0.3)" : "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 6,
                      padding: "7px 10px",
                      color: "#e0e2e6",
                      fontSize: 12,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        background: "#32363e",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ fontSize: 11, color: "#9a9da4" }}>
          {testCallRunning
            ? `🧪 テストコール実行中 — テキスト ${transcript.length} 件`
            : callActive
            ? `通話中${dualMode ? "（2ch分離）" : ""} — テキスト ${transcript.length} 件認識`
            : "待機中 — F2で通話開始"}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {!callActive && !testCallRunning ? (
            <>
              <button onClick={startCall} style={{
                background: "linear-gradient(135deg, #4caf50, #2e7d32)",
                border: "none",
                borderRadius: 10,
                padding: "10px 28px",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: "0.05em",
                boxShadow: "0 4px 20px rgba(76,175,80,0.3)",
              }}>
                🎙️ 通話開始（音声認識）
              </button>
              <button onClick={runTestCall} style={{
                background: "linear-gradient(135deg, #42a5f5, #1565c0)",
                border: "none",
                borderRadius: 10,
                padding: "10px 20px",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: "0.05em",
                boxShadow: "0 4px 20px rgba(66,165,245,0.3)",
              }}>
                🧪 テストコール
              </button>
            </>
          ) : testCallRunning ? (
            <button onClick={stopTestCall} style={{
              background: "linear-gradient(135deg, #ff9800, #e65100)",
              border: "none",
              borderRadius: 10,
              padding: "10px 28px",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.05em",
              boxShadow: "0 4px 20px rgba(255,152,0,0.3)",
            }}>
              ⏹ テスト中止
            </button>
          ) : (
            <button onClick={endCall} style={{
              background: "linear-gradient(135deg, #ef5350, #b71c1c)",
              border: "none",
              borderRadius: 10,
              padding: "10px 28px",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.05em",
              boxShadow: "0 4px 20px rgba(239,83,80,0.3)",
            }}>
              📵 通話終了
            </button>
          )}
          <button onClick={() => {
            setTranscript([]);
            setKbResults([]);
            setAiResponse("");
            setPinnedAiResponse("");
            aiPinnedRef.current = false;
            setEditableSummary({ timestamp: "", caller_name: "", category: "", summary: "", callback_number: "", contract_name: "", contract_address: "", callback_assignee: "", operator: "" });
            manualFieldsRef.current = new Set();
            conversationIdRef.current = "";
            lastSentRef.current = "";
          }} style={{
            background: "#3a3f48",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "10px 20px",
            color: "#9a9da4",
            fontSize: 13,
            cursor: "pointer",
          }}>
            クリア
          </button>
          <button onClick={() => setShowCorrectionPanel(s => !s)} style={{
            background: showCorrectionPanel ? "rgba(76,175,80,0.15)" : "#3a3f48",
            border: showCorrectionPanel ? "1px solid rgba(76,175,80,0.4)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "10px 14px",
            color: showCorrectionPanel ? "#4caf50" : "#9a9da4",
            fontSize: 12,
            cursor: "pointer",
          }}>
            📝 補正辞書
          </button>
          <button onClick={() => setShowDeviceSettings(s => !s)} disabled={callActive} style={{
            background: showDeviceSettings ? "rgba(171,71,188,0.15)" : "#3a3f48",
            border: showDeviceSettings ? "1px solid rgba(171,71,188,0.4)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "10px 14px",
            color: showDeviceSettings ? "#ab47bc" : "#9a9da4",
            fontSize: 12,
            cursor: callActive ? "not-allowed" : "pointer",
            opacity: callActive ? 0.5 : 1,
          }}>
            🎧 音声設定
          </button>
          <button onClick={toggleDebug} style={{
            background: debugMode ? "rgba(100,181,246,0.1)" : "#3a3f48",
            border: debugMode ? "1px solid rgba(100,181,246,0.3)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "10px 14px",
            color: debugMode ? "#64b5f6" : "#9a9da4",
            fontSize: 12,
            cursor: "pointer",
          }}>
            🔧 デバッグ
          </button>
        </div>
      </div>

      {/* Custom Correction Panel */}
      {showCorrectionPanel && (
        <div style={{
          position: "fixed",
          bottom: 60,
          right: 24,
          zIndex: 200,
          background: "#32363e",
          border: "1px solid rgba(76,175,80,0.3)",
          borderRadius: 14,
          padding: "20px 24px",
          width: 420,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          animation: "fadeSlideIn 0.3s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#4caf50", letterSpacing: "0.05em" }}>
              📝 カスタム補正辞書
            </div>
            <button onClick={() => setShowCorrectionPanel(false)} style={{
              background: "none", border: "none", color: "#9a9da4", fontSize: 16, cursor: "pointer",
            }}>✕</button>
          </div>
          <div style={{ fontSize: 10, color: "#9a9da4", marginBottom: 12, lineHeight: 1.6 }}>
            音声認識の誤り → 正しいテキスト のペアを登録すると、以降の認識結果に自動適用されます。
          </div>

          {/* 追加フォーム */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 6, marginBottom: 14,
            padding: "10px 12px",
            background: "#383c44",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#ef5350", fontSize: 10, width: 28, flexShrink: 0 }}>誤り</span>
              <input
                value={correctionFrom}
                onChange={e => setCorrectionFrom(e.target.value)}
                placeholder="例: いっつの宮"
                style={{
                  flex: 1,
                  background: "#3a3f48",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  color: "#e0e2e6",
                  fontSize: 12,
                  outline: "none",
                  minWidth: 0,
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#4caf50", fontSize: 10, width: 28, flexShrink: 0 }}>正解</span>
              <input
                value={correctionTo}
                onChange={e => setCorrectionTo(e.target.value)}
                placeholder="例: 一の宮町"
                onKeyDown={e => {
                  if (e.key === "Enter" && correctionFrom.trim() && correctionTo.trim()) {
                    const updated = addCustomCorrection(correctionFrom.trim(), correctionTo.trim());
                    setCustomCorrections(updated);
                    setCorrectionFrom("");
                    setCorrectionTo("");
                  }
                }}
                style={{
                  flex: 1,
                  background: "#3a3f48",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  color: "#e0e2e6",
                  fontSize: 12,
                  outline: "none",
                  minWidth: 0,
                }}
              />
            </div>
            <button
              onClick={() => {
                if (correctionFrom.trim() && correctionTo.trim()) {
                  const updated = addCustomCorrection(correctionFrom.trim(), correctionTo.trim());
                  setCustomCorrections(updated);
                  setCorrectionFrom("");
                  setCorrectionTo("");
                }
              }}
              disabled={!correctionFrom.trim() || !correctionTo.trim()}
              style={{
                background: correctionFrom.trim() && correctionTo.trim() ? "rgba(76,175,80,0.2)" : "#3a3f48",
                border: "1px solid rgba(76,175,80,0.3)",
                borderRadius: 8,
                padding: "8px 0",
                color: correctionFrom.trim() && correctionTo.trim() ? "#4caf50" : "#6a6d74",
                fontSize: 12,
                cursor: correctionFrom.trim() && correctionTo.trim() ? "pointer" : "not-allowed",
                fontWeight: 700,
                width: "100%",
                marginTop: 2,
              }}
            >
              追加
            </button>
          </div>

          {/* 登録済み一覧 */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: 10,
          }}>
            {customCorrections.length === 0 ? (
              <div style={{ textAlign: "center", color: "#6a6d74", fontSize: 11, padding: "20px 0" }}>
                登録された補正パターンはありません
              </div>
            ) : (
              customCorrections.map((c, i) => (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  marginBottom: 4,
                  background: "#383c44",
                  borderRadius: 6,
                  fontSize: 12,
                }}>
                  <span style={{ color: "#ef5350", flex: 1, wordBreak: "break-all" }}>{c.from}</span>
                  <span style={{ color: "#9a9da4", flexShrink: 0 }}>→</span>
                  <span style={{ color: "#4caf50", flex: 1, wordBreak: "break-all" }}>{c.to}</span>
                  <button
                    onClick={() => {
                      const updated = removeCustomCorrection(i);
                      setCustomCorrections(updated);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#9a9da4",
                      fontSize: 14,
                      cursor: "pointer",
                      padding: "2px 6px",
                      flexShrink: 0,
                    }}
                    title="削除"
                  >✕</button>
                </div>
              ))
            )}
          </div>
          <div style={{ fontSize: 10, color: "#6a6d74", marginTop: 8, textAlign: "right" }}>
            {customCorrections.length} 件登録済み
          </div>
        </div>
      )}

      {/* Audio Device Settings Panel */}
      {showDeviceSettings && (
        <div style={{
          position: "fixed",
          bottom: 60,
          right: 24,
          zIndex: 200,
          background: "#32363e",
          border: "1px solid rgba(171,71,188,0.3)",
          borderRadius: 14,
          padding: "20px 24px",
          width: 380,
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          animation: "fadeSlideIn 0.3s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ab47bc", letterSpacing: "0.05em" }}>
              🎧 音声デバイス設定
            </div>
            <button onClick={() => setShowDeviceSettings(false)} style={{
              background: "none", border: "none", color: "#9a9da4", fontSize: 16, cursor: "pointer",
            }}>✕</button>
          </div>

          {/* デュアルモード切替 */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
            padding: "10px 14px",
            background: dualMode ? "rgba(171,71,188,0.08)" : "#383c44",
            border: dualMode ? "1px solid rgba(171,71,188,0.25)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            cursor: "pointer",
          }} onClick={() => setDualMode(d => !d)}>
            <div style={{
              width: 38, height: 20, borderRadius: 10,
              background: dualMode ? "#ab47bc" : "#ccc",
              position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: "50%",
                background: "#fff",
                position: "absolute", top: 2,
                left: dualMode ? 20 : 2,
                transition: "left 0.2s",
              }}/>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e0e2e6" }}>
                2ch 音声分離モード
              </div>
              <div style={{ fontSize: 10, color: "#9a9da4", marginTop: 2 }}>
                オペレーターとお客様の音声を分離して認識
              </div>
            </div>
          </div>

          {/* デバイス選択 */}
          {audioDevices.length === 0 ? (
            <div style={{ fontSize: 11, color: "#9a9da4", textAlign: "center", padding: "12px 0" }}>
              オーディオデバイスが検出されませんでした。<br/>マイクの権限を許可してページをリロードしてください。
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: "#64b5f6", letterSpacing: "0.08em", marginBottom: 6, display: "block" }}>
                  🎤 オペレーター マイク {!dualMode && <span style={{ color: "#9a9da4" }}>（シングルモード: メインマイク）</span>}
                </label>
                <select
                  value={operatorDeviceId}
                  onChange={e => setOperatorDeviceId(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#3a3f48",
                    border: "1px solid rgba(100,181,246,0.25)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    color: "#e0e2e6",
                    fontSize: 12,
                    outline: "none",
                    appearance: "none",
                  }}
                >
                  <option value="" style={{ background: "#32363e" }}>（デフォルトデバイス）</option>
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId} style={{ background: "#32363e" }}>
                      {d.label || `デバイス ${d.deviceId.slice(0, 8)}...`}
                    </option>
                  ))}
                </select>
              </div>

              {dualMode && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: "#5c6bc0", letterSpacing: "0.08em", marginBottom: 6, display: "block" }}>
                    📞 お客様音声（VB-CABLE等の仮想デバイス）
                  </label>
                  <select
                    value={customerDeviceId}
                    onChange={e => setCustomerDeviceId(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#3a3f48",
                      border: "1px solid rgba(92,107,192,0.25)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      color: "#e0e2e6",
                      fontSize: 12,
                      outline: "none",
                      appearance: "none",
                    }}
                  >
                    <option value="" style={{ background: "#32363e" }}>（デバイスを選択）</option>
                    {audioDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId} style={{ background: "#32363e" }}>
                        {d.label || `デバイス ${d.deviceId.slice(0, 8)}...`}
                      </option>
                    ))}
                  </select>
                  {!customerDeviceId && (
                    <div style={{ fontSize: 10, color: "#ef5350", marginTop: 4 }}>
                      お客様用デバイスを選択してください（VB-CABLE Output等）
                    </div>
                  )}
                </div>
              )}

              {dualMode && (
                <div style={{
                  padding: "10px 12px",
                  background: "rgba(92,107,192,0.06)",
                  border: "1px solid rgba(92,107,192,0.12)",
                  borderRadius: 8,
                  fontSize: 10,
                  color: "#9a9da4",
                  lineHeight: 1.7,
                }}>
                  <strong style={{ color: "#5c6bc0" }}>セットアップ手順:</strong><br/>
                  1. VB-CABLE をインストール<br/>
                  2. Smart PBX の出力先を「CABLE Input」に設定<br/>
                  3. Windows サウンド設定で「CABLE Output」→「このデバイスを聴く」を有効化<br/>
                  4. 上のドロップダウンで「CABLE Output」を選択
                </div>
              )}

              {/* VB-Audio 自動トリガー */}
              <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 10,
                  padding: "10px 14px",
                  background: triggerEnabled ? "rgba(76,175,80,0.08)" : "#383c44",
                  border: triggerEnabled ? "1px solid rgba(76,175,80,0.25)" : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  cursor: "pointer",
                }} onClick={() => setTriggerEnabled(v => !v)}>
                  <div style={{
                    width: 38, height: 20, borderRadius: 10,
                    background: triggerEnabled ? "#4caf50" : "#ccc",
                    position: "relative", transition: "background 0.2s", flexShrink: 0,
                  }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: "50%",
                      background: "#fff",
                      position: "absolute", top: 2,
                      left: triggerEnabled ? 20 : 2,
                      transition: "left 0.2s",
                    }}/>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#e0e2e6", display: "flex", alignItems: "center", gap: 6 }}>
                      VB-Audio 自動トリガー
                      {triggerEnabled && triggerDeviceId && triggerStreamRef.current && (
                        <span style={{
                          fontSize: 9, background: "rgba(76,175,80,0.2)", border: "1px solid rgba(76,175,80,0.4)",
                          borderRadius: 10, padding: "1px 7px", color: "#4caf50",
                        }}>監視中</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "#9a9da4", marginTop: 2 }}>
                      音声を検出したら自動で通話開始（非通話中のみ）
                    </div>
                  </div>
                </div>

                {triggerEnabled && (
                  <div>
                    <label style={{ fontSize: 10, color: "#4caf50", letterSpacing: "0.08em", marginBottom: 6, display: "block" }}>
                      トリガー監視デバイス（VB-Audio Input等）
                    </label>
                    <select
                      value={triggerDeviceId}
                      onChange={e => setTriggerDeviceId(e.target.value)}
                      style={{
                        width: "100%",
                        background: "#3a3f48",
                        border: "1px solid rgba(76,175,80,0.25)",
                        borderRadius: 8,
                        padding: "8px 10px",
                        color: "#e0e2e6",
                        fontSize: 12,
                        outline: "none",
                        appearance: "none",
                      }}
                    >
                      <option value="" style={{ background: "#32363e" }}>（デバイスを選択）</option>
                      {audioDevices.map(d => (
                        <option key={d.deviceId} value={d.deviceId} style={{ background: "#32363e" }}>
                          {d.label || `デバイス ${d.deviceId.slice(0, 8)}...`}
                        </option>
                      ))}
                    </select>
                    {!triggerDeviceId && (
                      <div style={{ fontSize: 10, color: "#ef5350", marginTop: 4 }}>
                        監視するデバイスを選択してください
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Call Summary Modal */}
      {showSummaryModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          animation: "fadeSlideIn 0.3s ease",
        }}>
          <div style={{
            background: "#32363e",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 16,
            width: "90%",
            maxWidth: 520,
            maxHeight: "85vh",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }}>
            {/* Modal Header */}
            <div style={{
              padding: "18px 24px 14px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>📋</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#5c6bc0", letterSpacing: "0.05em" }}>
                  通話記録の保存
                </span>
              </div>
              <button
                onClick={() => setShowSummaryModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#9a9da4",
                  fontSize: 18,
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >✕</button>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: "auto" }}>

            {/* Status Banner */}
            {saveStatus === "summarizing" && (
              <div style={{
                margin: "12px 24px 0",
                padding: "8px 14px",
                background: "rgba(100,181,246,0.08)",
                border: "1px solid rgba(100,181,246,0.2)",
                borderRadius: 8,
                fontSize: 12,
                color: "#64b5f6",
                animation: "blink 1s infinite",
              }}>
                AI が通話内容を分析中...
              </div>
            )}
            {saveStatus === "saved" && (
              <div style={{
                margin: "12px 24px 0",
                padding: "8px 14px",
                background: "rgba(76,175,80,0.08)",
                border: "1px solid rgba(76,175,80,0.25)",
                borderRadius: 8,
                fontSize: 12,
                color: "#4caf50",
              }}>
                保存しました
              </div>
            )}
            {saveStatus === "error" && (
              <div style={{
                margin: "12px 24px 0",
                padding: "8px 14px",
                background: "rgba(239,83,80,0.08)",
                border: "1px solid rgba(239,83,80,0.25)",
                borderRadius: 8,
                fontSize: 12,
                color: "#ef5350",
              }}>
                保存に失敗しました。再試行してください。
              </div>
            )}

            {/* Editable Fields */}
            <div style={{ padding: "16px 24px 20px" }}>
              {[
                { key: "timestamp", label: "タイムコード", icon: "🕐" },
                { key: "caller_name", label: "名前", icon: "👤" },
                { key: "category", label: "カテゴリー", icon: "📂", type: "select",
                  options: ["接続障害","速度低下","料金・請求","解約・退会","機器設定","その他"] },
                { key: "summary", label: "内容", icon: "📝", multiline: true },
                { key: "callback_number", label: "電話番号", icon: "📞" },
                { key: "contract_name", label: "契約者名", icon: "📋" },
                { key: "contract_address", label: "契約住所", icon: "🏠" },
                { key: "callback_assignee", label: "折返担当者", icon: "🔄" },
                { key: "operator", label: "受領者", icon: "🧑‍💼" },
              ].map(({ key, label, icon, type, options, multiline }) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <label style={{
                    fontSize: 11,
                    color: "#9a9da4",
                    letterSpacing: "0.08em",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 6,
                  }}>
                    <span>{icon}</span> {label}
                  </label>
                  {type === "select" ? (
                    <select
                      value={editableSummary[key]}
                      onChange={e => handleEditField(key, e.target.value)}
                      style={{
                        width: "100%",
                        background: "#3a3f48",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        padding: "9px 12px",
                        color: "#e0e2e6",
                        fontSize: 13,
                        outline: "none",
                        appearance: "none",
                      }}
                    >
                      {options.map(o => <option key={o} value={o} style={{ background: "#32363e" }}>{o}</option>)}
                    </select>
                  ) : multiline ? (
                    <textarea
                      value={editableSummary[key]}
                      onChange={e => handleEditField(key, e.target.value)}
                      rows={3}
                      style={{
                        width: "100%",
                        background: "#3a3f48",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        padding: "9px 12px",
                        color: "#e0e2e6",
                        fontSize: 13,
                        lineHeight: 1.7,
                        outline: "none",
                        resize: "vertical",
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                      }}
                    />
                  ) : (
                    <input
                      value={editableSummary[key]}
                      onChange={e => handleEditField(key, e.target.value)}
                      style={{
                        width: "100%",
                        background: "#3a3f48",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        padding: "9px 12px",
                        color: "#e0e2e6",
                        fontSize: 13,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  )}
                </div>
              ))}

              {/* Callback highlight */}
              {callSummary && callSummary.callback_needed && (
                <div style={{
                  padding: "10px 14px",
                  background: "rgba(92,107,192,0.08)",
                  border: "1px solid rgba(92,107,192,0.2)",
                  borderRadius: 10,
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <span style={{ fontSize: 16 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#5c6bc0", marginBottom: 2 }}>
                      折り返し連絡が必要です
                    </div>
                    {callSummary.callback_reason && (
                      <div style={{ fontSize: 11, color: "#9a9da4" }}>
                        {callSummary.callback_reason}
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
            </div>{/* end scrollable content */}

            {/* Footer: 常に下部に固定 */}
            <div style={{
              padding: "14px 24px",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              gap: 10,
              flexShrink: 0,
            }}>
              <button
                onClick={handleSaveSummary}
                disabled={saveStatus === "saving"}
                style={{
                  flex: 1,
                  background: "linear-gradient(135deg, #5c6bc0, #3f51b5)",
                  border: "none",
                  borderRadius: 10,
                  padding: "11px 20px",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: saveStatus === "saving" ? "wait" : "pointer",
                  letterSpacing: "0.05em",
                  opacity: saveStatus === "saving" ? 0.6 : 1,
                }}
              >
                {saveStatus === "saving" ? "保存中..." : "📤 スプレッドシートに保存"}
              </button>
              <button
                onClick={() => setShowSummaryModal(false)}
                style={{
                  background: "#3a3f48",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  padding: "11px 18px",
                  color: "#9a9da4",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
      </>)}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
        input::placeholder { color: #6a6d74; }
        select::-ms-expand { display: none; }
        textarea::placeholder { color: #6a6d74; }
      `}</style>
    </div>
  );
}
