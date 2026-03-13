import { useState, useEffect, useRef, useCallback } from "react";

const DIFY_API_URL = "https://api.dify.ai/v1/chat-messages";
const DIFY_API_KEY = "app-3FRus6A0PmVdDo8oFDT2r90G";

// Google Apps Script Web App URL（デプロイ後に設定）
const GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwQB3QO1AYO2TnkmnFQRugNGCEGwMj3x7ewBtDYzRbnpg3yfTVgngln99qv8xqenzjb/exec";

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
    operator: "",
  });
  const debugModeRef = useRef(false);
  const transcriptRef = useRef(null);
  const timerRef = useRef(null);
  const difyTimerRef = useRef(null);
  const conversationIdRef = useRef("");
  const lastSentRef = useRef("");
  const recognitionRef = useRef(null);
  const restartAttemptsRef = useRef(0);
  const noSpeechCountRef = useRef(0);
  const interimRef = useRef(""); // 未確定テキスト保持（セッション切断時の救出用）
  const transcriptLinesRef = useRef([]); // onresultからtranscript参照用
  const audioContextRef = useRef(null);
  const micStreamRef = useRef(null);
  const callActiveRef = useRef(false);

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

  const callDifyAPI = useCallback(async (fullText) => {
    if (!fullText.trim() || fullText === lastSentRef.current) return;
    lastSentRef.current = fullText;
    setAiLoading(true);

    try {
      const res = await fetch(DIFY_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${DIFY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: {},
          query: `以下はお客様との通話内容です。この内容に基づいて、オペレーターが取るべき対応手順を簡潔に案内してください。\n\n通話内容:\n${fullText}`,
          response_mode: "blocking",
          conversation_id: conversationIdRef.current || undefined,
          user: "operator",
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      if (data.conversation_id) {
        conversationIdRef.current = data.conversation_id;
      }
      setAiResponse(data.answer || "回答を取得できませんでした。");
    } catch (err) {
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

      if (!res.ok) throw new Error(`API error: ${res.status}`);
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
        body: JSON.stringify(data),
      });
      // no-corsモードではレスポンスが不透明になるため、送信成功とみなす
      return true;
    } catch (err) {
      console.error("Spreadsheet save error:", err);
      return false;
    }
  }, []);

  const scheduleDifyCall = useCallback((lines, interim = "") => {
    clearTimeout(difyTimerRef.current);
    const fullText = lines.map(l => l.text).join("\n") + (interim ? "\n" + interim : "");
    difyTimerRef.current = setTimeout(() => callDifyAPI(fullText), 500);
  }, [callDifyAPI]);

  const addLine = (text) => {
    setTranscript(prev => {
      const lines = [...prev, { id: Date.now() + Math.random(), text, ts: new Date().toLocaleTimeString("ja-JP", {hour:"2-digit",minute:"2-digit",second:"2-digit"}) }];
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
          const finalText = event.results[i][0].transcript;
          addDebug(`📝 result(final): "${finalText}"`);
          interimRef.current = "";
          setInterimText("");
          addLine(finalText);
        } else {
          const interim = event.results[i][0].transcript;
          addDebug(`... result(interim): "${interim}"`);
          interimRef.current = interim;
          setInterimText(interim);
          // interimでもKB検索+Dify APIを実行（即答性向上）
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
      // 未確定テキストが残っていたら確定として救出
      if (interimRef.current.trim()) {
        addDebug(`🛟 rescue interim: "${interimRef.current.trim()}"`);
        addLine(interimRef.current.trim());
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

  const stopSpeechRecognition = () => {
    // 通話終了時は onend の rescue に任せるため interimRef はここではクリアしない
    if (recognitionRef.current) {
      const ref = recognitionRef.current;
      recognitionRef.current = null;
      ref.stop();
    }
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

  // ── F2キーで通話開始/終了トグル ──────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "F2") {
        e.preventDefault();
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
    conversationIdRef.current = "";
    lastSentRef.current = "";
    startSpeechRecognition();
    if (debugModeRef.current) startMicMonitor();
  };

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

    if (currentTranscript.length === 0) return;

    // 通話要約を生成してモーダルに表示
    const summary = await summarizeCall(currentTranscript);
    if (summary) {
      setCallSummary(summary);
      setEditableSummary({
        timestamp: new Date().toLocaleString("ja-JP"),
        caller_name: summary.caller_name || "不明",
        category: summary.category || "その他",
        summary: summary.summary || "",
        callback_number: summary.callback_number || "",
        operator: operatorName,
      });
      setSaveStatus("");
      setShowSummaryModal(true);
    }
  };

  const handleSaveSummary = async () => {
    const saved = await saveToSpreadsheet(editableSummary);
    setSaveStatus(saved ? "saved" : (GAS_WEBHOOK_URL ? "error" : "saved"));
    if (saved || !GAS_WEBHOOK_URL) {
      setTimeout(() => setShowSummaryModal(false), 1200);
    }
  };

  const handleEditField = (field, value) => {
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

  if (!isLoggedIn) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#0a0f1e",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
        color: "#e8eaf0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #0d1535, #111d3d)",
          border: "1px solid rgba(255,183,77,0.2)",
          borderRadius: 20,
          padding: "48px 40px",
          width: "100%",
          maxWidth: 380,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          textAlign: "center",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "linear-gradient(135deg, #ffb74d, #ff8f00)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28, margin: "0 auto 20px",
          }}>📞</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#ffb74d", letterSpacing: "0.08em", marginBottom: 6 }}>
            ASO NET
          </div>
          <div style={{ fontSize: 11, color: "#8892a4", letterSpacing: "0.05em", marginBottom: 32 }}>
            OPERATOR ASSIST SYSTEM
          </div>

          <div style={{ textAlign: "left", marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "#8892a4", letterSpacing: "0.08em" }}>
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
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 10,
              padding: "12px 16px",
              color: "#e8eaf0",
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
                ? "linear-gradient(135deg, #ffb74d, #ff8f00)"
                : "rgba(255,255,255,0.08)",
              border: "none",
              borderRadius: 10,
              padding: "12px 20px",
              color: loginInput.trim() ? "#0a0f1e" : "#8892a4",
              fontSize: 14,
              fontWeight: 700,
              cursor: loginInput.trim() ? "pointer" : "default",
              letterSpacing: "0.05em",
              transition: "all 0.2s",
            }}
          >
            ログイン
          </button>
          <div style={{ fontSize: 10, color: "#4a5568", marginTop: 16 }}>
            ログイン状態は6時間保持されます
          </div>
        </div>
        <style>{`
          input::placeholder { color: #4a5568; }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0f1e",
      fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      color: "#e8eaf0",
      display: "flex",
      flexDirection: "column",
      paddingBottom: 60,
    }}>
      {/* Header */}
      <header style={{
        background: "linear-gradient(90deg, #0d1535 0%, #111d3d 100%)",
        borderBottom: "1px solid rgba(255,183,77,0.2)",
        padding: "0 24px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #ffb74d, #ff8f00)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16,
          }}>📞</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: "#ffb74d" }}>
              ASO NET — オペレーターアシスト
            </div>
            <div style={{ fontSize: 10, color: "#8892a4", letterSpacing: "0.05em" }}>
              NETWORK SUPPORT AI ASSISTANT
            </div>
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
          <div style={{ fontSize: 11, color: "#8892a4" }}>
            {new Date().toLocaleDateString("ja-JP", { year:"numeric", month:"long", day:"numeric", weekday:"short" })}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            borderLeft: "1px solid rgba(255,255,255,0.1)",
            paddingLeft: 16,
          }}>
            <span style={{ fontSize: 12, color: "#e8eaf0" }}>{operatorName}</span>
            <button onClick={handleLogout} style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "3px 10px",
              color: "#8892a4",
              fontSize: 10,
              cursor: "pointer",
            }}>ログアウト</button>
          </div>
        </div>
      </header>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", gap: 0 }}>

        {/* Left: Transcript Panel */}
        <div style={{
          width: "30%",
          minWidth: 300,
          borderRight: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          flexDirection: "column",
        }}>
          <div style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#8892a4" }}>
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
              background: "rgba(100,181,246,0.06)",
              border: "1px solid rgba(100,181,246,0.2)",
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
                      background: "rgba(255,255,255,0.1)",
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
                {transcript.map((line) => (
                  <div key={line.id} style={{
                    marginBottom: 14,
                    animation: "fadeSlideIn 0.3s ease",
                  }}>
                    <div style={{ fontSize: 10, color: "#8892a4", marginBottom: 4 }}>
                      {line.ts} — お客様
                    </div>
                    <div style={{
                      background: "rgba(255,183,77,0.06)",
                      border: "1px solid rgba(255,183,77,0.15)",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontSize: 14,
                      lineHeight: 1.7,
                      color: "#e8eaf0",
                    }}>
                      {line.text}
                    </div>
                  </div>
                ))}
                {interimText && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: "#8892a4", marginBottom: 4 }}>
                      認識中...
                    </div>
                    <div style={{
                      background: "rgba(255,183,77,0.03)",
                      border: "1px dashed rgba(255,183,77,0.2)",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontSize: 14,
                      lineHeight: 1.7,
                      color: "#8892a4",
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
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ fontSize: 10, color: "#8892a4", marginBottom: 8, letterSpacing: "0.08em" }}>
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
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#e8eaf0",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <button
                onClick={handleManualSearch}
                style={{
                  background: "rgba(255,183,77,0.15)",
                  border: "1px solid rgba(255,183,77,0.4)",
                  borderRadius: 8,
                  color: "#ffb74d",
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >送信</button>
            </div>
          </div>
        </div>

        {/* Right: AI Guide Panel */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#8892a4" }}>
              ▌ AIアシスト — 対応ガイド
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {kbResults.length > 0 && kbResults.map((r, i) => (
                <span key={i} style={{
                  background: i === 0 ? "rgba(255,183,77,0.15)" : "rgba(255,255,255,0.05)",
                  border: i === 0 ? "1px solid rgba(255,183,77,0.35)" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 20,
                  padding: "3px 12px",
                  fontSize: 11,
                  color: i === 0 ? "#ffb74d" : "#8892a4",
                  fontWeight: 700,
                }}>
                  {r.category}
                </span>
              ))}
              {aiLoading && (
                <span style={{ fontSize: 10, color: "#64b5f6", animation: "blink 1s infinite" }}>
                  AI分析中...
                </span>
              )}
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
                {/* KB Quick Results */}
                {kbResults.length > 0 && (
                  <div style={{
                    animation: animateResult ? "fadeSlideIn 0.4s ease" : "none",
                    marginBottom: 24,
                  }}>
                    <div style={{ fontSize: 11, color: "#8892a4", letterSpacing: "0.1em", marginBottom: 12 }}>
                      クイックガイド
                    </div>
                    {kbResults.map((result, ri) => (
                      <div key={ri} style={{
                        marginBottom: ri < kbResults.length - 1 ? 20 : 0,
                        animation: `fadeSlideIn 0.3s ease ${ri * 0.1}s both`,
                      }}>
                        <div style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: ri === 0 ? "#ffb74d" : "#8892a4",
                          marginBottom: 8,
                        }}>
                          {result.category}
                        </div>
                        {result.steps.map((step, i) => (
                          <div key={i} style={{
                            display: "flex",
                            gap: 14,
                            marginBottom: 10,
                            animation: `fadeSlideIn 0.3s ease ${(ri * 0.1 + i * 0.08)}s both`,
                          }}>
                            <div style={{
                              width: 24, height: 24,
                              borderRadius: "50%",
                              background: ri === 0
                                ? "linear-gradient(135deg, #ffb74d22, #ff8f0022)"
                                : "rgba(255,255,255,0.05)",
                              border: ri === 0 ? "1.5px solid #ffb74d66" : "1.5px solid rgba(255,255,255,0.15)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              flexShrink: 0,
                              fontSize: 11, fontWeight: 800,
                              color: ri === 0 ? "#ffb74d" : "#8892a4",
                            }}>
                              {i + 1}
                            </div>
                            <div style={{
                              background: "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(255,255,255,0.08)",
                              borderRadius: 10,
                              padding: "8px 12px",
                              fontSize: 13,
                              lineHeight: 1.7,
                              flex: 1,
                              color: "#d0d8e8",
                            }}>
                              {step}
                            </div>
                          </div>
                        ))}
                        <div style={{
                          background: "rgba(100,181,246,0.06)",
                          border: "1px solid rgba(100,181,246,0.2)",
                          borderRadius: 12,
                          padding: "12px 14px",
                          display: "flex",
                          gap: 10,
                          marginTop: 12,
                        }}>
                          <div style={{ fontSize: 16, flexShrink: 0 }}>💡</div>
                          <div style={{ fontSize: 12, color: "#90caf9", lineHeight: 1.8 }}>
                            {result.tip}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* AI Response from Dify */}
                {(aiResponse || aiLoading) && (
                  <div style={{
                    background: "rgba(76,175,80,0.04)",
                    border: "1px solid rgba(76,175,80,0.15)",
                    borderRadius: 14,
                    padding: "18px 20px",
                    animation: "fadeSlideIn 0.4s ease",
                  }}>
                    <div style={{
                      fontSize: 11, color: "#4caf50", fontWeight: 700,
                      letterSpacing: "0.1em", marginBottom: 12,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <span>🤖</span>
                      <span>AI ナレッジ回答</span>
                    </div>
                    {aiLoading && !aiResponse ? (
                      <div style={{ fontSize: 13, color: "#8892a4", animation: "blink 1s infinite" }}>
                        ナレッジを検索中...
                      </div>
                    ) : (
                      <div style={{
                        fontSize: 14,
                        lineHeight: 2,
                        color: "#d0d8e8",
                        whiteSpace: "pre-wrap",
                      }}>
                        {aiResponse}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
        borderTop: "1px solid rgba(255,255,255,0.07)",
        background: "#0d1535",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ fontSize: 11, color: "#8892a4" }}>
          {callActive ? `通話中 — テキスト ${transcript.length} 件認識` : "待機中 — F2で通話開始"}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {!callActive ? (
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
            </>
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
          <button onClick={() => { setTranscript([]); setKbResults([]); setAiResponse(""); conversationIdRef.current = ""; lastSentRef.current = ""; }} style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "10px 20px",
            color: "#8892a4",
            fontSize: 13,
            cursor: "pointer",
          }}>
            クリア
          </button>
          <button onClick={toggleDebug} style={{
            background: debugMode ? "rgba(100,181,246,0.15)" : "rgba(255,255,255,0.06)",
            border: debugMode ? "1px solid rgba(100,181,246,0.4)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "10px 14px",
            color: debugMode ? "#64b5f6" : "#8892a4",
            fontSize: 12,
            cursor: "pointer",
          }}>
            🔧 デバッグ
          </button>
        </div>
      </div>

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
            background: "#111d3d",
            border: "1px solid rgba(255,183,77,0.25)",
            borderRadius: 16,
            width: "90%",
            maxWidth: 520,
            maxHeight: "85vh",
            overflowY: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
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
                <span style={{ fontSize: 14, fontWeight: 700, color: "#ffb74d", letterSpacing: "0.05em" }}>
                  通話記録の保存
                </span>
              </div>
              <button
                onClick={() => setShowSummaryModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#8892a4",
                  fontSize: 18,
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >✕</button>
            </div>

            {/* Status Banner */}
            {saveStatus === "summarizing" && (
              <div style={{
                margin: "12px 24px 0",
                padding: "8px 14px",
                background: "rgba(100,181,246,0.08)",
                border: "1px solid rgba(100,181,246,0.25)",
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
                { key: "operator", label: "受領者", icon: "🧑‍💼" },
              ].map(({ key, label, icon, type, options, multiline }) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <label style={{
                    fontSize: 11,
                    color: "#8892a4",
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
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        padding: "9px 12px",
                        color: "#e8eaf0",
                        fontSize: 13,
                        outline: "none",
                        appearance: "none",
                      }}
                    >
                      {options.map(o => <option key={o} value={o} style={{ background: "#111d3d" }}>{o}</option>)}
                    </select>
                  ) : multiline ? (
                    <textarea
                      value={editableSummary[key]}
                      onChange={e => handleEditField(key, e.target.value)}
                      rows={3}
                      style={{
                        width: "100%",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        padding: "9px 12px",
                        color: "#e8eaf0",
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
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        padding: "9px 12px",
                        color: "#e8eaf0",
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
                  background: "rgba(255,183,77,0.08)",
                  border: "1px solid rgba(255,183,77,0.3)",
                  borderRadius: 10,
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <span style={{ fontSize: 16 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#ffb74d", marginBottom: 2 }}>
                      折り返し連絡が必要です
                    </div>
                    {callSummary.callback_reason && (
                      <div style={{ fontSize: 11, color: "#8892a4" }}>
                        {callSummary.callback_reason}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  onClick={handleSaveSummary}
                  disabled={saveStatus === "saving"}
                  style={{
                    flex: 1,
                    background: "linear-gradient(135deg, #ffb74d, #ff8f00)",
                    border: "none",
                    borderRadius: 10,
                    padding: "11px 20px",
                    color: "#0a0f1e",
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
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 10,
                    padding: "11px 18px",
                    color: "#8892a4",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        input::placeholder { color: #4a5568; }
        select::-ms-expand { display: none; }
        textarea::placeholder { color: #4a5568; }
      `}</style>
    </div>
  );
}
