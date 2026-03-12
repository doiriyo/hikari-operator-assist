import { useState, useEffect, useRef, useCallback } from "react";

const DIFY_API_URL = "https://api.dify.ai/v1/chat-messages";
const DIFY_API_KEY = "app-3FRus6A0PmVdDo8oFDT2r90G";

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
  if (!text || text.length < 3) return null;
  const lower = text.toLowerCase().replace(/\s/g, "");
  let best = null, bestScore = 0;
  for (const item of MOCK_KB) {
    const score = item.keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

const DEMO_SCRIPT = [
  { delay: 1200, text: "もしもし、え〜と、ネットが昨日から" },
  { delay: 900, text: "繋がらなくて困っているんですが" },
  { delay: 1100, text: "インターネットが全然繋がらないんです" },
];

export default function App() {
  const [transcript, setTranscript] = useState([]);
  const [kbResult, setKbResult] = useState(null);
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
  const transcriptRef = useRef(null);
  const timerRef = useRef(null);
  const demoRef = useRef(null);
  const difyTimerRef = useRef(null);
  const conversationIdRef = useRef("");
  const lastSentRef = useRef("");
  const recognitionRef = useRef(null);
  const restartAttemptsRef = useRef(0);
  const noSpeechCountRef = useRef(0);

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

  const scheduleDifyCall = useCallback((lines) => {
    clearTimeout(difyTimerRef.current);
    const fullText = lines.map(l => l.text).join("\n");
    difyTimerRef.current = setTimeout(() => callDifyAPI(fullText), 2000);
  }, [callDifyAPI]);

  const addLine = (text) => {
    setTranscript(prev => {
      const lines = [...prev, { id: Date.now() + Math.random(), text, ts: new Date().toLocaleTimeString("ja-JP", {hour:"2-digit",minute:"2-digit",second:"2-digit"}) }];
      const fullText = lines.map(l => l.text).join(" ");
      const found = searchKB(fullText);
      if (found) {
        setAnimateResult(false);
        setTimeout(() => { setKbResult(found); setAnimateResult(true); }, 50);
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
          addDebug(`📝 result(final): "${event.results[i][0].transcript}"`);
          setInterimText("");
          addLine(event.results[i][0].transcript);
        } else {
          addDebug(`... result(interim): "${event.results[i][0].transcript}"`);
          setInterimText(event.results[i][0].transcript);
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
    if (recognitionRef.current) {
      const ref = recognitionRef.current;
      recognitionRef.current = null;
      ref.stop();
    }
  };

  const startCall = () => {
    setCallActive(true);
    setIsListening(true);
    setTranscript([]);
    setKbResult(null);
    setAiResponse("");
    setSpeechError("");
    conversationIdRef.current = "";
    lastSentRef.current = "";
    startSpeechRecognition();
  };

  const startDemo = () => {
    setCallActive(true);
    setIsListening(true);
    setTranscript([]);
    setKbResult(null);
    setAiResponse("");
    setSpeechError("");
    conversationIdRef.current = "";
    lastSentRef.current = "";
    let cumDelay = 500;
    DEMO_SCRIPT.forEach(({ delay, text }) => {
      cumDelay += delay;
      demoRef.current = setTimeout(() => addLine(text), cumDelay);
    });
  };

  const endCall = () => {
    setCallActive(false);
    setIsListening(false);
    setSpeechError("");
    setInterimText("");
    clearTimeout(demoRef.current);
    clearTimeout(difyTimerRef.current);
    stopSpeechRecognition();
  };

  const handleManualSearch = () => {
    if (!inputText.trim()) return;
    addLine(inputText.trim());
    setInputText("");
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0f1e",
      fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      color: "#e8eaf0",
      display: "flex",
      flexDirection: "column",
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

          {callActive && speechDebug.length > 0 && (
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
              maxHeight: 120,
              overflowY: "auto",
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>🔍 音声認識デバッグ</div>
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
              {kbResult && (
                <span style={{
                  background: "rgba(255,183,77,0.15)",
                  border: "1px solid rgba(255,183,77,0.35)",
                  borderRadius: 20,
                  padding: "3px 12px",
                  fontSize: 11,
                  color: "#ffb74d",
                  fontWeight: 700,
                }}>
                  {kbResult.category}
                </span>
              )}
              {aiLoading && (
                <span style={{ fontSize: 10, color: "#64b5f6", animation: "blink 1s infinite" }}>
                  AI分析中...
                </span>
              )}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {!kbResult && !aiResponse ? (
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
                {/* KB Quick Result */}
                {kbResult && (
                  <div style={{
                    animation: animateResult ? "fadeSlideIn 0.4s ease" : "none",
                    marginBottom: 24,
                  }}>
                    <div style={{ fontSize: 11, color: "#8892a4", letterSpacing: "0.1em", marginBottom: 12 }}>
                      クイックガイド
                    </div>
                    {kbResult.steps.map((step, i) => (
                      <div key={i} style={{
                        display: "flex",
                        gap: 14,
                        marginBottom: 10,
                        animation: `fadeSlideIn 0.3s ease ${i * 0.08}s both`,
                      }}>
                        <div style={{
                          width: 24, height: 24,
                          borderRadius: "50%",
                          background: "linear-gradient(135deg, #ffb74d22, #ff8f0022)",
                          border: "1.5px solid #ffb74d66",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                          fontSize: 11, fontWeight: 800, color: "#ffb74d",
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
                        {kbResult.tip}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                      {MOCK_KB.map(item => (
                        <button
                          key={item.category}
                          onClick={() => {
                            setAnimateResult(false);
                            setTimeout(() => { setKbResult(item); setAnimateResult(true); }, 50);
                          }}
                          style={{
                            background: kbResult.category === item.category
                              ? "rgba(255,183,77,0.2)"
                              : "rgba(255,255,255,0.04)",
                            border: kbResult.category === item.category
                              ? "1px solid rgba(255,183,77,0.5)"
                              : "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 20,
                            padding: "4px 12px",
                            fontSize: 11,
                            color: kbResult.category === item.category ? "#ffb74d" : "#8892a4",
                            cursor: "pointer",
                            transition: "all 0.2s",
                          }}
                        >
                          {item.category}
                        </button>
                      ))}
                    </div>
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
        borderTop: "1px solid rgba(255,255,255,0.07)",
        background: "#0d1535",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ fontSize: 11, color: "#8892a4" }}>
          {callActive ? `通話中 — テキスト ${transcript.length} 件認識` : "待機中"}
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
              <button onClick={startDemo} style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 10,
                padding: "10px 20px",
                color: "#8892a4",
                fontSize: 13,
                cursor: "pointer",
              }}>
                📞 デモ
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
          <button onClick={() => { setTranscript([]); setKbResult(null); setAiResponse(""); conversationIdRef.current = ""; lastSentRef.current = ""; }} style={{
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
        </div>
      </div>

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
      `}</style>
    </div>
  );
}
