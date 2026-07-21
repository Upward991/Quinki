import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{children: React.ReactNode}, {error: string | null}> {
  state: {error: string | null} = {error: null}
  
  static getDerivedStateFromError(error: Error) {
    return {error: error.message + `\n` + (error.stack || '')}
  }
  
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '20px', color: '#ff6666', fontFamily: 'monospace', fontSize: '14px', whiteSpace: 'pre-wrap' }}>
          {this.state.error}
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)