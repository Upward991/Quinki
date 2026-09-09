// runtime.ts — A4.3: runtime dei bundle delle tab.
// Carica un pacchetto (manifest + bundle), valuta il bundle con un contesto
// { React, Quinki } e monta il pannello. Le API Quinki sono SIMULATE per test
// (note in localStorage, agent.ask risposta simulata, toast).
import React from 'react'
import { useState, useEffect } from 'react'
import { findTabPackage } from './runtimePackages'
import { findCatalogItem } from '../catalog'

export interface QuinkiAPI {
  React: typeof React
  useState: typeof useState
  useEffect: typeof useEffect
  manifest: any
  call: (method: string, params?: any) => Promise<any> // RPC generico (anche i back-end delle tab)
  notes: {
    read: () => string
    write: (text: string) => void
  }
  agent: {
    ask: (prompt: string) => Promise<string | null>
  }
  ui: {
    toast: (msg: string) => void
  }
}

export interface QuinkiRuntimeOpts {
  call?: (method: string, params?: any) => Promise<any>
  onToast?: (msg: string) => void
}

const NOTES_KEYS: Record<string, string> = {}
function notesKey(tabId: string): string {
  if (!NOTES_KEYS[tabId]) NOTES_KEYS[tabId] = 'quinki-runtime-notes-' + tabId
  return NOTES_KEYS[tabId]
}

export function makeQuinki(manifest: any, opts?: QuinkiRuntimeOpts): QuinkiAPI {
  const call = opts?.call
  const onToast = opts?.onToast
  return {
    React,
    useState,
    useEffect,
    manifest,
    call: async (method: string, params?: any) => {
      if (!call) throw new Error('sidecar not connected')
      return call(method, params || {})
    },
    notes: {
      read: () => { try { return localStorage.getItem(notesKey(manifest.id)) || '' } catch { return '' } },
      write: (text: string) => { try { localStorage.setItem(notesKey(manifest.id), text) } catch {} },
    },
    agent: {
      ask: async (_prompt: string) => {
        return 'Simulated AI: I read your note. (agent.ask reale arriva con la fase 2 di A4.3)'
      },
    },
    ui: {
      toast: (msg: string) => { if (onToast) onToast(msg) },
    },
  }
}

// Genera un pacchetto generico dal manifest del catalogo (per le tab senza bundle specifico):
// il pannello mostra nome, descrizione, un'area note con Save (usa Quinki.notes).
function makeGenericPackage(id: string, item: any) {
  return {
    manifest: { id, name: item.name, version: item.version, author: item.author, description: item.description, icon: '✨', color: item.color, permissions: [], entry: 'bundle.js' },
    code: "return function Tab({ quinki }) {\n" +
      "  const [text, setText] = quinki.useState(quinki.notes.read())\n" +
      "  return quinki.React.createElement('div', { style: { height: '100%', padding: '24px 32px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' } },\n" +
      "    quinki.React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' } },\n" +
      "      quinki.React.createElement('span', { style: { fontSize: '20px' } }, quinki.manifest.icon),\n" +
      "      quinki.React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '17px', fontWeight: 700, fontFamily: 'var(--font-interface)' } }, quinki.manifest.name),\n" +
      "      quinki.React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginLeft: 'auto' } }, 'installed tab · v' + quinki.manifest.version)\n" +
      "    ),\n" +
      "    quinki.React.createElement('div', { style: { color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '14px' } }, quinki.manifest.description),\n" +
      "    quinki.React.createElement('textarea', { value: text, onChange: (e) => setText(e.target.value), placeholder: 'Write here…', style: { flex: 1, resize: 'none', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', padding: '14px', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', outline: 'none' } }),\n" +
      "    quinki.React.createElement('button', { onClick: () => { quinki.notes.write(text); quinki.ui.toast('Saved') }, style: { marginTop: '12px', alignSelf: 'flex-start', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', background: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Save')\n" +
      "  )\n" +
      "} ",
  }
}

// Valuta il bundle e restituisce la funzione componente.
export function loadTabComponent(id: string, opts?: QuinkiRuntimeOpts): (props: { quinki: QuinkiAPI }) => any {
  const item = findCatalogItem(id)
  const pkg = findTabPackage(id) || (item ? makeGenericPackage(id, item) : undefined)
  if (!pkg) return () => null
  try {
    const factory = new Function('React', 'useState', 'useEffect', 'Quinki', pkg.code)
    const comp = factory(React, useState, useEffect, makeQuinki(pkg.manifest, opts))
    return typeof comp === 'function' ? comp : () => null
  } catch (e) {
    console.error('tab bundle error', id, e)
    return () => null
  }
}

// Cache: il componente del bundle NON cambia tra render (evita remount e perdita stato)
const compCache: Record<string, (props: { quinki: QuinkiAPI }) => any> = {}
export function getTabComponent(id: string, opts?: QuinkiRuntimeOpts) {
  if (!compCache[id]) compCache[id] = loadTabComponent(id, opts)
  return compCache[id]
}

// Componente wrapper: monta il pannello della tab via runtime
// A4.3: riceve il 'call' del sidecar per le API reali (RPC generico + back-end tab)
export function RuntimeTabPanel({ tabId, call, onToast }: { tabId: string, call?: (method: string, params?: any) => Promise<any>, onToast?: (msg: string) => void }) {
  const pkg = findTabPackage(tabId)
  if (!pkg) return null
  const opts: QuinkiRuntimeOpts = { call, onToast }
  const Component = getTabComponent(tabId, opts)
  const quinki = makeQuinki(pkg.manifest, opts)
  return React.createElement(Component, { quinki })
}
