import React from 'react'
import { useState, useCallback } from 'react'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Bot, Terminal, MessageSquare, Settings, Brain } from '../icons'

const tabs = [
  {id:'expert', icon:Bot, label:'Quinki Expert', color:'var(--q-accent-orange)', panel:'expert', doubleBot:false},
  {id:'chat', icon:MessageSquare, label:'Chat', color:'var(--q-accent-info)', panel:'chat', doubleBot:false},
  {id:'log', icon:Terminal, label:'Log', color:'var(--q-accent-success)', panel:'log', doubleBot:false},
  {id:'agents', icon:Bot, label:'Agents', color:'var(--q-accent-secondary)', panel:'agents', doubleBot:true},
  {id:'settings', icon:Settings, label:'Settings', color:'var(--q-accent-primary)', panel:'settings', doubleBot:false},
]

export function HomeView({onSelectPanel}: {onSelectPanel: (panel: string) => void}) {
  const [ctxMenu, setCtxMenu] = useState<{x: number, y: number, card: any} | null>(null)

  // Prevent default context menu globally on home
  const onContext = useCallback((e: React.MouseEvent, card: any) => {
    // Only show custom menu for tabs that CAN be opened in new window
    // (not chat, not expert — expert always opens in new window anyway)
    if (card.id === 'chat' || card.id === 'expert') return
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({x: e.clientX, y: e.clientY, card})
  }, [])

  return React.createElement('div',
    {className:'h-full flex items-center justify-center', style:{backgroundColor:'var(--q-bg)'}},
    React.createElement('div',
      {style:{maxWidth:'600px', padding:'32px', margin:'0 auto'}},
      React.createElement('div',
        {className:'flex flex-wrap', style:{gap:'10px'}},
        tabs.map((card, idx) => 
          React.createElement(HomeCard, {key:card.id, card, idx, onSelectPanel, onContext}, card.id)
        )
      )
    ),
    // Custom context menu
    ctxMenu && React.createElement(React.Fragment, null,
      React.createElement('div', {
        style: {position:'fixed', inset:0, zIndex:9998, backgroundColor:'transparent'},
        onClick: () => setCtxMenu(null),
        onContextMenu: (e: any) => { e.preventDefault(); setCtxMenu(null) }
      }),
      React.createElement('div', {
        style: {
          position:'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 180),
          top: Math.min(ctxMenu.y, window.innerHeight - 50),
          zIndex:9999, backgroundColor:'var(--q-bg-panel)',
          borderRadius:'var(--radius-md)', boxShadow:'var(--shadow-modal)',
          border:'1px solid var(--q-border)', padding:'4px 0', minWidth:'160px'
        }
      },
        React.createElement(CtxItem, {
          label: 'Open in new window',
          icon: '↗',
          onClick: () => {
            try {
            const label = 'win-' + ctxMenu.card.id
            WebviewWindow.getByLabel(label).then((existing: any) => {
              if (existing) { existing.show(); existing.setFocus() }
              else {
                new WebviewWindow(label, {
                  url: 'index.html?tab=' + ctxMenu.card.id,
                  title: '', width: 1000, height: 700, minWidth: 600, minHeight: 400,
                  decorations: true, hiddenTitle: true, titleBarStyle: 'Overlay',
                })
              }
            }).catch(() => {})
          } catch {}
            setCtxMenu(null)
          }
        })
      )
    )
  )
}

function CtxItem({label, icon, onClick}: {label: string, icon?: string, onClick: () => void}) {
  const [hovered, setHovered] = useState(false)
  return React.createElement('button', {
    onClick,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    style: {
      display:'flex', alignItems:'center', width:'100%', padding:'8px 12px',
      border:'none', cursor:'pointer',
      backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
      color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
      fontSize:'14px', fontFamily:'var(--font-interface)', textAlign:'left',
      gap:'8px', transition:'none'
    }
  },
    icon && React.createElement('span', {style:{fontSize:'14px', opacity:0.7}}, icon),
    label
  )
}

function HomeCard({card, idx, onSelectPanel, onContext}: any) {
  const [hovered, setHovered] = useState(false)
  const Icon = card.icon
  return React.createElement('button',
    {
      onClick: () => card.panel && onSelectPanel(card.panel),
      onContextMenu: (e: any) => onContext(e, card),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        width:'160px', height:'120px', backgroundColor:'var(--q-bg-panel)',
        borderRadius:'var(--radius-lg)',
        border:`1px solid ${hovered ? 'var(--q-border-strong)' : 'var(--q-border)'}`,
        boxShadow: hovered ? '0 0 0 1px var(--q-border-strong), 0 0 24px rgba(157, 139, 217, 0.06), inset 0 1px 0 rgba(255,255,255,0.02)' : 'var(--shadow-floating)',
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        cursor:'pointer', position:'relative', overflow:'hidden',
        animation:`staggerIn 300ms cubic-bezier(0.16, 1, 0.3, 1) ${idx*40}ms both`,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'none'
      }
    },
    React.createElement('div', {style:{position:'absolute', inset:0, background:`radial-gradient(ellipse 80% 60% at 50% 50%, ${card.color}, transparent 70%)`, opacity:hovered?0.06:0, transition: 'none', pointerEvents:'none'}}),
    React.createElement('div', {style:{display:'flex', alignItems:'center', justifyContent:'center', transform:hovered?'scale(1.05)':'scale(1)', transition: 'none'}},
      card.doubleBot ? React.createElement(Bot, {size:28, style:{color:card.color}}) : React.createElement(Icon, {size:28, style:{color:card.color}})
    ),
    React.createElement('div', {style:{height:'10px'}}),
    React.createElement('span', {style:{color:'var(--q-text)', fontSize:'14px', fontWeight:500, fontFamily:'var(--font-interface)'}}, card.label),

  )
}