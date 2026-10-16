// Model dropdown condiviso (L1 - rottura dipendenza circolare SettingsPanel <-> FallbackModelsSection).
// Estratto VERBATIM da SettingsPanel.tsx il 16 ott 2026 (nessun cambio di logica): Gh (dropdown con
// ricerca) + Kh (riga della lista). SettingsPanel e FallbackModelsSection lo importano da qui.
import React from 'react'
import { useState } from 'react'
import { ChevronDown, Search } from '../icons'
import { BottomSheet } from '../chat/BottomSheet'

export function Gh({ label: e, items: t, currentValue: n, onChange: r }) {
  let [i, a] = useState(!1),
    mob = typeof window !== 'undefined' && window.innerWidth <= 600,
    [o, s] = useState(``),
    c = o
      ? t.filter(
          (e) =>
            e.label.toLowerCase().includes(o.toLowerCase()) ||
            e.sublabel?.toLowerCase().includes(o.toLowerCase()),
        )
      : t
  return React.createElement(`div`, {
    style: { position: `relative` },
    children: [
      React.createElement(`button`, {
        onClick: () => {
          ;(a(!i), s(``))
        },
        style: {
          width: `100%`,
          padding: `7px 10px`,
          borderRadius: `var(--radius-sm)`,
          border: `1px solid var(--q-border)`,
          cursor: `pointer`,
          backgroundColor: `var(--q-bg-elevated)`,
          display: `flex`,
          alignItems: `center`,
          gap: `4px`,
        },
        children: [
          React.createElement(`span`, {
            style: {
              flex: 1,
              color: `var(--q-text)`,
              fontSize: `13px`,
              fontFamily: `var(--font-interface)`,
              overflow: `hidden`,
              textOverflow: `ellipsis`,
              whiteSpace: `nowrap`,
              textAlign: `left`,
            },
            children: e,
          }),
          React.createElement(ChevronDown, {
            size: 12,
            style: { color: `var(--q-text-tertiary)`, flexShrink: 0 },
          }),
        ],
      }),
      i &&
        !mob &&
        React.createElement(React.Fragment, {
          children: [
            React.createElement(`div`, {
              style: { position: `fixed`, inset: 0, zIndex: 40, overscrollBehavior: `contain` },
              onClick: () => a(!1),
            }),
            React.createElement(`div`, {
              style: {
                position: `absolute`,
                top: `calc(100% + 4px)`,
                left: `0`,
                right: `0`,
                zIndex: 50,
                backgroundColor: `var(--q-bg-elevated)`,
                borderRadius: `var(--radius-md)`,
                border: `1px solid var(--q-border)`,
                boxShadow: `var(--shadow-floating)`,
                maxHeight: `300px`,
                display: `flex`,
                flexDirection: `column`,
                overscrollBehavior: `contain`,
              },
              children: [
                t.length > 5 &&
                  React.createElement(`div`, {
                    style: {
                      display: `flex`,
                      alignItems: `center`,
                      gap: `8px`,
                      padding: `8px 12px`,
                      flexShrink: 0,
                    },
                    children: [
                      React.createElement(Search, {
                        size: 14,
                        style: { color: `var(--q-text-tertiary)`, flexShrink: 0 },
                      }),
                      React.createElement(`input`, {
                        type: `text`,
                        placeholder: `Search...`,
                        value: o,
                        onChange: (e) => s(e.target.value),
                        autoFocus: !(
                          typeof window !== 'undefined' &&
                          !window.__TAURI_INTERNALS__ &&
                          window.innerWidth <= 600
                        ),
                        style: {
                          flex: 1,
                          backgroundColor: `transparent`,
                          border: `none`,
                          outline: `none`,
                          color: `var(--q-text)`,
                          fontSize: `13px`,
                          fontFamily: `var(--font-interface)`,
                        },
                      }),
                      o &&
                        React.createElement(`button`, {
                          onClick: () => s(``),
                          style: {
                            background: `none`,
                            border: `none`,
                            cursor: `pointer`,
                            color: `var(--q-text-tertiary)`,
                            fontSize: `13px`,
                          },
                          children: `✕`,
                        }),
                    ],
                  }),
                React.createElement(`div`, {
                  style: { overflowY: `auto`, flex: 1, padding: `4px 0` },
                  children: [
                    c.map((e) =>
                      React.createElement(
                        Kh,
                        {
                          label: e.label,
                          sublabel: e.sublabel,
                          isSelected: e.value === n,
                          onTap: () => {
                            ;(r?.(e.value), a(!1))
                          },
                        },
                        e.value,
                      ),
                    ),
                    c.length === 0 &&
                      React.createElement(`div`, {
                        style: {
                          padding: `12px`,
                          color: `var(--q-text-tertiary)`,
                          fontSize: `13px`,
                          fontFamily: `var(--font-interface)`,
                          textAlign: `center`,
                        },
                        children: `No results`,
                      }),
                  ],
                }),
              ],
            }),
          ],
        }),
      i &&
        mob &&
        React.createElement(BottomSheet, {
          open: !0,
          onClose: () => {
            a(!1)
            s(``)
          },
          hideBack: !0,
          hideNav: !0,
          items: [],
          view: React.createElement(React.Fragment, {
            children: [
              React.createElement(`div`, {
                children: c.map((it, idx) =>
                  React.createElement(`div`, {
                    key: idx,
                    onClick: () => {
                      r(it.value)
                      a(!1)
                      s(``)
                    },
                    onMouseEnter: (e) => {
                      e.currentTarget.style.backgroundColor = `rgba(255,255,255,0.06)`
                    },
                    onMouseLeave: (e) => {
                      e.currentTarget.style.backgroundColor = `transparent`
                    },
                    style: {
                      display: `flex`,
                      alignItems: `center`,
                      gap: `12px`,
                      padding: `10px 12px`,
                      borderRadius: `var(--radius-md)`,
                      cursor: `pointer`,
                    },
                    children: [
                      React.createElement(`span`, {
                        style: {
                          flex: 1,
                          minWidth: 0,
                          color: `var(--q-text)`,
                          fontSize: `15px`,
                          fontFamily: `var(--font-interface)`,
                          overflow: `hidden`,
                          textOverflow: `ellipsis`,
                          whiteSpace: `nowrap`,
                        },
                        children: String(it.label),
                      }),
                      it.sublabel
                        ? React.createElement(`span`, {
                            style: {
                              color: `var(--q-text-tertiary)`,
                              fontSize: `12px`,
                              fontFamily: `var(--font-interface)`,
                              flexShrink: 1,
                              minWidth: 0,
                              overflow: `hidden`,
                              textOverflow: `ellipsis`,
                              whiteSpace: `nowrap`,
                              textAlign: `right`,
                            },
                            children: String(it.sublabel),
                          })
                        : null,
                    ],
                  }),
                ),
              }),
              React.createElement(`div`, {
                style: {
                  display: `flex`,
                  alignItems: `center`,
                  gap: `8px`,
                  marginTop: `4px`,
                  padding: `0 4px`,
                },
                children: [
                  React.createElement(Search, {
                    size: 14,
                    style: { color: `var(--q-text-tertiary)`, flexShrink: 0 },
                  }),
                  React.createElement(`input`, {
                    type: `text`,
                    placeholder: `Search...`,
                    value: o,
                    onChange: (e) => s(e.target.value),
                    style: {
                      flex: 1,
                      minWidth: 0,
                      backgroundColor: `transparent`,
                      border: `none`,
                      outline: `none`,
                      color: `var(--q-text)`,
                      fontSize: `14px`,
                      fontFamily: `var(--font-interface)`,
                      padding: `8px 0`,
                    },
                  }),
                  React.createElement(`button`, {
                    onClick: () => {
                      a(!1)
                      s(``)
                    },
                    style: {
                      padding: `7px 16px`,
                      borderRadius: `var(--radius-sm)`,
                      border: `1px solid var(--q-border)`,
                      backgroundColor: `transparent`,
                      color: `var(--q-accent-danger)`,
                      fontSize: `13px`,
                      fontFamily: `var(--font-interface)`,
                      cursor: `pointer`,
                      flexShrink: 0,
                    },
                    children: `Close`,
                  }),
                ],
              }),
              c.length === 0 &&
                React.createElement(`div`, {
                  style: {
                    padding: `12px`,
                    color: `var(--q-text-tertiary)`,
                    fontSize: `13px`,
                    fontFamily: `var(--font-interface)`,
                    textAlign: `center`,
                  },
                  children: `No results`,
                }),
            ],
          }),
        }),
    ],
  })
}
function Kh({ label: e, sublabel: t, isSelected: n, onTap: r }) {
  let [i, a] = useState(!1)
  return React.createElement(`div`, {
    onClick: r,
    onMouseEnter: () => a(!0),
    onMouseLeave: () => a(!1),
    style: {
      padding: `8px 12px`,
      cursor: `pointer`,
      backgroundColor: i ? `var(--q-hover)` : n ? `var(--q-border-soft)` : `transparent`,
      display: `flex`,
      alignItems: `center`,
      transform: i ? `scale(1.02)` : `scale(1)`,
      transition: `none`,
    },
    children: [
      React.createElement(`span`, {
        style: {
          flex: 1,
          color: `var(--q-text)`,
          fontSize: `13px`,
          fontFamily: `var(--font-interface)`,
          overflow: `hidden`,
          textOverflow: `ellipsis`,
          whiteSpace: `nowrap`,
        },
        children: e,
      }),
      t &&
        React.createElement(`span`, {
          style: { color: `var(--q-text-tertiary)`, fontSize: `12px`, flexShrink: 0 },
          children: t,
        }),
    ],
  })
}
