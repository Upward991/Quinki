import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string | null}> {
  state: {error: string | null} = {error: null}
  static getDerivedStateFromError(error: Error) {
    return {error: error.message + '\n' + (error.stack || '')}
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', 
        {style: {padding:'20px',color:'red',fontFamily:'monospace',fontSize:'14px',whiteSpace:'pre-wrap',background:'white',minHeight:'100vh'}}, 
        'ERROR: ' + this.state.error
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
)
