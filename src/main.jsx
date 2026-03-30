import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("React crash:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 40, background: "#0a0f1e", color: "#ef5350",
          minHeight: "100vh", fontFamily: "monospace",
        }}>
          <h2 style={{ color: "#ffb74d" }}>アプリケーションエラー</h2>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 16, color: "#e8eaf0", fontSize: 13, lineHeight: 1.8 }}>
            {this.state.error.toString()}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 20, padding: "10px 24px",
              background: "#ffb74d", border: "none", borderRadius: 8,
              color: "#0a0f1e", fontWeight: 700, cursor: "pointer",
            }}
          >
            リロード
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
