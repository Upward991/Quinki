import React from 'react'

export const QuinkiMascot: React.FC<{ size?: number; style?: React.CSSProperties; color?: string }> = ({ size = 20, style, color }) => (
  <svg width={size} height={size} viewBox="0 0 128 128" style={{ ...style, color: color || style?.color || 'currentColor' }} xmlns="http://www.w3.org/2000/svg">
    <mask id="mascot-mask">
      <image width="128" height="128" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABTUlEQVR4nO3SMQEAIAzAMMC/5yFjRxMFPXpnZg5ZbzuAXQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEGSDOAHEGiDNAnAHiDBBngDgDxBkgzgBxBogzQJwB4gwQZ4A4A8QZIM4AcQaIM0CcAeIMEGeAOAPEfXf7BPxx499DAAAAAElFTkSuQmCC" style={{ filter: 'brightness(0) invert(1)' }} />
    </mask>
    <rect width="128" height="128" fill="currentColor" mask="url(#mascot-mask)" />
  </svg>
)
