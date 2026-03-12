import { useState, useEffect, useRef } from "react";

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
  const [result, setResult] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [inputText, setInputText] = useState("");
  const [animateResult, setAnimateResult] = useState(false);
  const transcriptRef = useRef(null);
  const timerRef = useRef(null);
  const demoRef = useRef(null);

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

  const addLine = (text) => {
    setTranscript(prev => {
      const lines = [...prev, { id: Date.now() + Math.random(), text, ts: new Date().toLocaleTimeString("ja-JP", {hour:"2-digit",minute:"2-digit",second:"2-digit"}) }];
      const fullText = lines.map(l => l.text).join(" ");
      const found = searchKB(fullText);
      if (found) {
        setAnimateResult(false);
        setTimeout(() => { setResult(found); setAnimateResult(true); }, 50);
      }
      return lines;
    });
  };

  const startDemo = () => {
    setCallActive(true);
    setIsListening(true);
    setTranscript([]);
    setResult(null);
    let cumDelay = 500;
    DEMO_SCRIPT.forEach(({ delay, text }) => {
      cumDelay += delay;
      demoRef.current = setTimeout(() => addLine(text), cumDelay);
    });
  };

  const endCall = () => {
    setCallActive(false);
    setIsListening(false);
    clearTimeout(demoRef.current);
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
          {/* Panel Header */}
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

          {/* Transcript Lines */}
          <div ref={transcriptRef} style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
          }}>
            {transcript.length === 0 ? (
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
            ) : transcript.map((line) => (
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
          </div>

          {/* Manual Input */}
          <div style={{
            padding: "12px 16px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ fontSize: 10, color: "#8892a4", marginBottom: 8, letterSpacing: "0.08em" }}>
              ▌ キーワード手動検索
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
              >検索</button>
            </div>
          </div>
        </div>

        {/* Center: KB Quick Answer Panel */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid rgba(255,255,255,0.07)",
        }}>
          <div style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#8892a4" }}>
              ▌ クイックガイド
            </div>
            {result && (
              <span style={{
                background: "rgba(255,183,77,0.15)",
                border: "1px solid rgba(255,183,77,0.35)",
                borderRadius: 20,
                padding: "3px 12px",
                fontSize: 11,
                color: "#ffb74d",
                fontWeight: 700,
              }}>
                {result.category}
              </span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {!result ? (
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
                  通話内容を認識すると<br/>ここに案内手順が自動表示されます
                </div>
              </div>
            ) : (
              <div style={{
                animation: animateResult ? "fadeSlideIn 0.4s ease" : "none",
              }}>
                {/* Steps */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: "#8892a4", letterSpacing: "0.1em", marginBottom: 12 }}>
                    対応ステップ
                  </div>
                  {result.steps.map((step, i) => (
                    <div key={i} style={{
                      display: "flex",
                      gap: 14,
                      marginBottom: 12,
                      animation: `fadeSlideIn 0.3s ease ${i * 0.08}s both`,
                    }}>
                      <div style={{
                        width: 28, height: 28,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg, #ffb74d22, #ff8f0022)",
                        border: "1.5px solid #ffb74d66",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                        fontSize: 12, fontWeight: 800, color: "#ffb74d",
                      }}>
                        {i + 1}
                      </div>
                      <div style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 10,
                        padding: "10px 14px",
                        fontSize: 13,
                        lineHeight: 1.7,
                        flex: 1,
                        color: "#d0d8e8",
                      }}>
                        {step}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tip */}
                <div style={{
                  background: "rgba(100,181,246,0.06)",
                  border: "1px solid rgba(100,181,246,0.2)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  display: "flex",
                  gap: 12,
                }}>
                  <div style={{ fontSize: 18, flexShrink: 0 }}>💡</div>
                  <div>
                    <div style={{ fontSize: 10, color: "#64b5f6", fontWeight: 700, marginBottom: 5, letterSpacing: "0.1em" }}>
                      対応のヒント
                    </div>
                    <div style={{ fontSize: 13, color: "#90caf9", lineHeight: 1.8 }}>
                      {result.tip}
                    </div>
                  </div>
                </div>

                {/* Quick Tags */}
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 11, color: "#8892a4", letterSpacing: "0.1em", marginBottom: 10 }}>
                    関連カテゴリ
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {MOCK_KB.map(item => (
                      <button
                        key={item.category}
                        onClick={() => {
                          setAnimateResult(false);
                          setTimeout(() => { setResult(item); setAnimateResult(true); }, 50);
                        }}
                        style={{
                          background: result.category === item.category
                            ? "rgba(255,183,77,0.2)"
                            : "rgba(255,255,255,0.04)",
                          border: result.category === item.category
                            ? "1px solid rgba(255,183,77,0.5)"
                            : "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 20,
                          padding: "5px 14px",
                          fontSize: 12,
                          color: result.category === item.category ? "#ffb74d" : "#8892a4",
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                      >
                        {item.category}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Dify Chatbot Panel */}
        <div style={{
          width: "35%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#8892a4" }}>
              ▌ AIチャット — ナレッジ検索
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <iframe
              src="https://udify.app/chatbot/vP3wxVY446NCbJf5"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
              }}
              allow="microphone"
            />
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
            <button onClick={startDemo} style={{
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
              📞 デモ通話開始
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
          <button onClick={() => { setTranscript([]); setResult(null); }} style={{
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
