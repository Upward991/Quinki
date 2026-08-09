// ============================================================
// Quinki — Material Symbols icons via @iconify/react
// All icons: filled, rounded style (Material Symbols)
// ============================================================

import { Icon } from '@iconify/react'

type IconProps = { size?: number; style?: React.CSSProperties; className?: string; onClick?: () => void; title?: string; color?: string }

function makeIcon(iconName: string) {
  return ({ size = 20, style, className, onClick, color }: IconProps) => (
    <Icon icon={iconName} width={size} height={size} style={{ ...style, color: color || style?.color, display: 'flex', flexShrink: 0 }} className={className} onClick={onClick} />
  )
}

// ── All icons used in the app (Material Symbols rounded) ──
export const Home = makeIcon('material-symbols:home-rounded')
export const Bot = makeIcon('material-symbols:smart-toy-rounded')
export const Package = makeIcon('material-symbols:inventory-2-rounded')
export const Shield = makeIcon('material-symbols:shield-rounded')
export const Plus = makeIcon('material-symbols:add-rounded')
export const ChevronDown = makeIcon('material-symbols:expand-more-rounded')
export const ChevronUp = makeIcon('material-symbols:expand-less-rounded')
export const ChevronLeft = makeIcon('material-symbols:chevron-left-rounded')
export const ChevronRight = makeIcon('material-symbols:chevron-right-rounded')
export const Search = makeIcon('material-symbols:search-rounded')
export const Save = makeIcon('material-symbols:save-rounded')
export const Power = makeIcon('material-symbols:power-settings-new-rounded')
export const Pencil = makeIcon('material-symbols:edit-rounded')
export const X = makeIcon('material-symbols:close-rounded')
export const BookOpen = makeIcon('material-symbols:book-rounded')
export const Wrench = makeIcon('material-symbols:build-rounded')
export const Trash = makeIcon('material-symbols:delete-rounded')
export const Trash2 = makeIcon('material-symbols:delete-outline-rounded')
export const Play = makeIcon('material-symbols:play-arrow-rounded')
export const RotateCcw = makeIcon('material-symbols:restart-alt-rounded')
export const FileText = makeIcon('material-symbols:description-rounded')
export const ArrowDown = makeIcon('material-symbols:arrow-downward-rounded')
export const PanelLeft = makeIcon('ri:layout-left-fill')
export const MessageSquare = makeIcon('material-symbols:chat-rounded')
export const MessageSquarePlus = makeIcon('material-symbols:add-comment-rounded')
export const Download = makeIcon('material-symbols:download-rounded')
export const RefreshCw = makeIcon('material-symbols:refresh-rounded')
export const Pulse = makeIcon('material-symbols:graphic-eq-rounded')
export const Calendar = makeIcon('material-symbols:calendar-month-rounded')
export const Clock = makeIcon('material-symbols:schedule-rounded')
export const Cpu = makeIcon('material-symbols:memory-rounded')
export const Brain = makeIcon('material-symbols:psychology-rounded')
export const Network = makeIcon('material-symbols:lan-rounded')
export const Paperclip = makeIcon('material-symbols:attach-file-rounded')
export const Copy = makeIcon('material-symbols:content-copy-rounded')
export const Check = makeIcon('material-symbols:check-rounded')
export const Info = makeIcon('material-symbols:info-rounded')
export const Folder = makeIcon('material-symbols:folder-rounded')
export const FolderOpen = makeIcon('material-symbols:folder-open-rounded')
export const FolderPlus = makeIcon('ri:folder-add-fill')
export const Sparkles = makeIcon('ri:sparkling-2-fill')
export const Activity = makeIcon('material-symbols:monitoring-rounded')
export const Archive = makeIcon('material-symbols:archive-rounded')
export const Palette = makeIcon('material-symbols:palette')
export const Plug = makeIcon('material-symbols:electrical-services-rounded')
export const Settings = makeIcon('material-symbols:settings-rounded')
export const Terminal = makeIcon('material-symbols:terminal-rounded');export const FolderAdd = makeIcon('ri:folder-add-fill');export const Sync = makeIcon('material-symbols:cloud-done-rounded')
