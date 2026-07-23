import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

console.log('main.tsx loaded')

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string | null}> {
  state: {error: string | null} = {error: null}
  static getDerivedStateFromError(error: Error) {
    console.error('ErrorBoundary caught:', error)
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

console.log('About to render App')
// Color test: create a div with var(--q-bg) to compare with the actual UI bg
const testDiv = document.createElement('div')
testDiv.style.cssText = 'position:fixed;top:40px;right:8px;z-index:99999;width:80px;height:40px;border:2px solid white;background-color:var(--q-bg);'
document.body.appendChild(testDiv)
console.log('Color test div added')
createRoot(document.getElementById('root')!).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
)
console.log('Render called')
