'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { UploadCloud } from 'lucide-react'

// Simple util fetch wrappers
function getToken() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('signage_token') || ''
}

// Notify app and clear token on unauthorized
function announceUnauthorized() {
  try { localStorage.removeItem('signage_token') } catch {}
  try { window.dispatchEvent(new Event('signage_unauthorized')) } catch {}
}

async function api<T>(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'authorization': `Bearer ${getToken()}`,
    },
  })
  
  if (res.status === 401) {
    // Auto logout and notify listeners
    announceUnauthorized()
    throw new Error('Unauthorized - please login again')
  }
  
  if (!res.ok) {
    // Try to get error message from response
    let errorMsg = `HTTP ${res.status}: ${res.statusText}`
    try {
      const text = await res.text()
      if (text) {
        try {
          const parsed = JSON.parse(text)
          errorMsg = parsed.error || parsed.message || errorMsg
        } catch {
          // If not JSON, use the text directly if it looks like an error message
          if (text.length < 200 && !text.includes('<html')) {
            errorMsg = text
          }
        }
      }
    } catch {}
    throw new Error(errorMsg)
  }
  
  // Enhanced JSON parsing with bulletproof error handling
  const ct = res.headers.get('content-type') || ''
  
  try {
    // Always attempt JSON parsing for API responses
    return (await res.json()) as T
  } catch (parseErr) {
    // If JSON parsing fails, get the raw text to provide better error info
    try {
      const text = await res.clone().text()
      console.error('Admin: JSON parsing failed for response:', {
        url: path,
        status: res.status,
        contentType: ct,
        textPreview: text.substring(0, 200),
        parseError: parseErr instanceof Error ? parseErr.message : 'Unknown parse error'
      })
      
      // If response looks like HTML error page, extract useful info
      if (text.includes('<html') || text.includes('<!DOCTYPE')) {
        throw new Error(`Server returned HTML instead of JSON. Check server logs for details.`)
      }
      
      // If it's a short text response that doesn't look like JSON
      if (text.length < 500 && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
        throw new Error(`Server returned unexpected response: ${text.substring(0, 100)}`)
      }
      
      // For longer responses or ones that look like malformed JSON
      throw new Error(`JSON parsing failed: ${parseErr instanceof Error ? parseErr.message : 'Unknown error'}. Response starts with: ${text.substring(0, 100)}`)
    } catch (textErr) {
      // If we can't even read the response text
      throw new Error(`Failed to parse response and couldn't read response text: ${parseErr instanceof Error ? parseErr.message : 'Unknown error'}`)
    }
  }
}

export default function AdminPage() {
  const [token, setToken] = useState<string>('')
  const [password, setPassword] = useState('')
  const [files, setFiles] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string>('')
  const [startAt, setStartAt] = useState<string>('')
  const [endAt, setEndAt] = useState<string>('')
  const [order, setOrder] = useState<number>(0)
  const [players, setPlayers] = useState<Array<{ name: string; lastSeen: number }>>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  // New: friendlier scheduling and player controls state
  // Queue messages when WS is not yet ready; flush on open
  const pendingMsgsRef = useRef<any[]>([])
  const [days, setDays] = useState<number[]>([])
  const [allDay, setAllDay] = useState<boolean>(true)
  const [startTime, setStartTime] = useState<string>('09:00')
  const [endTime, setEndTime] = useState<string>('17:00')
  const [playerLabelInput, setPlayerLabelInput] = useState<string>('')
  const [oldAdminPass, setOldAdminPass] = useState<string>('')
  const [newAdminPass, setNewAdminPass] = useState<string>('')
  // External link form state
  const [linkName, setLinkName] = useState<string>('')
  const [linkUrl, setLinkUrl] = useState<string>('')
  // New: per-item duration seconds
  const [durationSeconds, setDurationSeconds] = useState<string>('')
  // NEW: duration (seconds) required when adding external links
  const [linkDurationSeconds, setLinkDurationSeconds] = useState<string>('')
  // Live preview reload key for hard refresh of iframe
  const [previewKey, setPreviewKey] = useState<number>(0)
  // Mute option for scheduled items (videos/links) - REMOVED
  const [muted, setMuted] = useState<boolean>(false)
  // Server settings state
  const [serverSettings, setServerSettings] = useState({
    autoStart: true,
    brightness: 100,
    orientation: 'landscape' as 'landscape' | 'portrait',
    defaultImageDuration: 10,
    defaultLinkDuration: 30,
  })
  // Drag & drop + progress state
  const [dragActive, setDragActive] = useState(false)
  const dragCounter = useRef(0)
  // Enhanced live preview state
  const [livePreviewNowPlaying, setLivePreviewNowPlaying] = useState<string>('')
  const [livePreviewPowered, setLivePreviewPowered] = useState<boolean>(true)
  const [livePreviewActiveIndex, setLivePreviewActiveIndex] = useState<number>(0)
  const [livePreviewTotalFiles, setLivePreviewTotalFiles] = useState<number>(0)
  const [livePreviewTotalSchedules, setLivePreviewTotalSchedules] = useState<number>(0)
  const [livePreviewDisplayListLength, setLivePreviewDisplayListLength] = useState<number>(0)
  const [livePreviewAutoStartEnabled, setLivePreviewAutoStartEnabled] = useState<boolean>(true)
  const [livePreviewHasAutoStarted, setLivePreviewHasAutoStarted] = useState<boolean>(false)
  const [livePreviewIsRefreshing, setLivePreviewIsRefreshing] = useState<boolean>(false)
  const [livePreviewLastUpdate, setLivePreviewLastUpdate] = useState<number>(Date.now())
  const [previewConnectionStatus, setPreviewConnectionStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown')
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null)
  type UploadItem = { id: string; name: string; progress: number; status: 'uploading'|'done'|'error'; error?: string }
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
  // Player controls UI state
  const [bright, setBright] = useState<number>(100)
  // Suppress preview echo while user is dragging sliders
  const suppressBrightUntilRef = useRef<number>(0)
  // NEW: track dragging to completely ignore preview echo while user is interacting
  const isDraggingBrightRef = useRef<boolean>(false)
  // NEW: for videos, allow choosing natural duration vs. custom override
  const [useNaturalVideo, setUseNaturalVideo] = useState<boolean>(true)
  // NEW: duration for immediate scheduling in Upload/Link flows
  const [uploadDurationSeconds, setUploadDurationSeconds] = useState<string>('')
  const [uploadKind, setUploadKind] = useState<'image'|'video'|''>('')

  useEffect(() => {
    const t = localStorage.getItem('signage_token') || ''
    setToken(t)

    // Prefill schedule start/end with sensible defaults (now .. +1h) in local time
    const pad = (n: number) => String(n).padStart(2, '0')
    const toLocalInput = (d: Date) => {
      const y = d.getFullYear()
      const m = pad(d.getMonth() + 1)
      const day = pad(d.getDate())
      const h = pad(d.getHours())
      const min = pad(d.getMinutes())
      return `${y}-${m}-${day}T${h}:${min}`
    }
    try {
      const now = new Date()
      now.setSeconds(0, 0)
      const plus1h = new Date(now.getTime() + 60 * 60 * 1000)
      setStartAt((prev) => prev || toLocalInput(now))
      setEndAt((prev) => prev || toLocalInput(plus1h))
    } catch {}

    // refresh moved after auth listener is attached to avoid missing 401 event
    // connect ws
    try {
      // Prefer relative WS first to avoid cross-origin/port issues
      let ws: WebSocket | null = null
      try { ws = new WebSocket('/api/ws') } catch {}
      if (!ws) {
        ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws')
      }
      wsRef.current = ws
      ws.onopen = () => {
        // Flush any pending messages queued before connection was ready
        try {
          const list = pendingMsgsRef.current
          pendingMsgsRef.current = []
          for (const msg of list) {
            try { ws!.send(JSON.stringify(msg)) } catch {}
          }
        } catch {}
      }
      ws.onmessage = (e) => {
        // refresh players/files on any signal with enhanced error handling
        try {
          const msgText = String(e.data || '')
          let msg
          try {
            msg = JSON.parse(msgText)
          } catch (jsonErr) {
            console.error('Admin WebSocket: JSON parse failed:', { data: msgText.substring(0, 200), error: jsonErr })
            return
          }
          
          if (msg.type === 'refresh' || msg.type === 'heartbeat' || msg.type === 'pong') {
            loadPlayers()
          }
        } catch (err) {
          console.error('Admin WebSocket: Message handling failed:', err)
        }
      }
      ws.onclose = () => { wsRef.current = null }
    } catch {}

    const id = setInterval(() => { loadPlayers() }, 15000)

    // Listen for unauthorized events to force login
    const onUnauthorized = () => {
      setToken('')
      toast.error('Session expired. Please login again.')
    }
    window.addEventListener('signage_unauthorized', onUnauthorized)

    // Now safe to refresh; 401 will trigger the above listener
    refresh()

    return () => { 
      clearInterval(id)
      window.removeEventListener('signage_unauthorized', onUnauthorized)
    }
  }, [])

  // Enhanced message listener for live preview sync
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data: any = e?.data
      if (!data || typeof data !== 'object') return
      
      if (data.type === 'player_state') {
        try {
          console.log('Admin: Received player state:', data)
          
          // Update all preview state
          setLivePreviewNowPlaying(data.nowPlaying?.name || '')
          setLivePreviewPowered(Boolean(data.powered))
          setLivePreviewActiveIndex(data.activeIndex || 0)
          setLivePreviewTotalFiles(data.totalFiles || 0)
          setLivePreviewTotalSchedules(data.totalSchedules || 0)
          setLivePreviewDisplayListLength(data.displayListLength || 0)
          setLivePreviewAutoStartEnabled(Boolean(data.autoStartEnabled))
          setLivePreviewHasAutoStarted(Boolean(data.hasAutoStarted))
          setLivePreviewIsRefreshing(Boolean(data.isRefreshing))
          setLivePreviewLastUpdate(data.timestamp || Date.now())
          setPreviewConnectionStatus('connected')
          
          // Sync brightness slider if not currently dragging
          if (typeof data.brightness === 'number' && !isDraggingBrightRef.current) {
            const now = Date.now()
            if (now > suppressBrightUntilRef.current) {
              setBright(Math.max(0, Math.min(200, Math.round(data.brightness))))
            }
          }
        } catch (err) {
          console.error('Admin: Failed to process player state:', err)
        }
      }
    }
    
    window.addEventListener('message', onMsg)
    
    // Set up connection status monitoring
    const connectionCheckInterval = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - livePreviewLastUpdate
      if (timeSinceLastUpdate > 10000) { // No update for 10 seconds
        setPreviewConnectionStatus('disconnected')
      }
    }, 5000)
    
    return () => {
      window.removeEventListener('message', onMsg)
      clearInterval(connectionCheckInterval)
    }
  }, [livePreviewLastUpdate, isDraggingBrightRef, suppressBrightUntilRef])

  function ensureWS(): Promise<void> {
    return new Promise((resolve) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) return resolve()
      try {
        // Prefer relative first
        let next: WebSocket | null = null
        try { next = new WebSocket('/api/ws') } catch {}
        if (!next) {
          next = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws')
        }
        wsRef.current = next
        next.onopen = () => {
          // Flush any pending messages once connected
          try {
            const list = pendingMsgsRef.current
            pendingMsgsRef.current = []
            for (const msg of list) {
              try { next!.send(JSON.stringify(msg)) } catch {}
            }
          } catch {}
          resolve()
        }
        next.onclose = () => resolve() // resolve anyway; we'll handle failure on send
      } catch {
        resolve()
      }
    })
  }

  async function broadcast(data: any) {
    await ensureWS()
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'broadcast', data }))
      } else {
        // Queue and attempt later without noisy toasts
        pendingMsgsRef.current.push({ type: 'broadcast', data })
        // Fire-and-forget HTTP fallback so players receive the event even if WS isn't open here
        try {
          fetch('/api/ws', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data }),
          }).catch(() => {})
        } catch {}
        // best-effort retry shortly
        setTimeout(() => { ensureWS() }, 500)
      }
    } catch {
      // As a fallback, keep it queued for next open and also POST once
      pendingMsgsRef.current.push({ type: 'broadcast', data })
      try {
        fetch('/api/ws', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data }),
        }).catch(() => {})
      } catch {}
    }
  }

  async function loadPlayers() {
    try {
      const res = await fetch('/api/players')
      
      // Enhanced JSON parsing with proper error handling
      let data
      try {
        data = await res.json()
      } catch (jsonErr) {
        const text = await res.clone().text().catch(() => 'Unable to read response')
        console.error('LoadPlayers: JSON parse failed:', { status: res.status, text: text.substring(0, 200), error: jsonErr })
        setPlayers([])
        return
      }
      
      if (data?.ok) {
        const now = Date.now()
        const seen = new Set<string>()
        const filtered = (data.players || [])
          // must have a name string
          .filter((p: any) => typeof p?.name === 'string')
          // sanitize/normalize name
          .map((p: any) => ({ ...p, name: String(p.name).trim() }))
          // require at least 2 visible characters and some alphanumeric
          .filter((p: any) => p.name.length >= 2 && /[a-z0-9]/i.test(p.name))
          // consider players active if seen within last 30s (matches 20s heartbeat)
          .filter((p: any) => typeof p.lastSeen === 'number' && now - p.lastSeen <= 30_000)
          // dedupe by normalized name
          .filter((p: any) => {
            const key = p.name.toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        setPlayers(filtered)
      } else {
        setPlayers([])
      }
    } catch {
      setPlayers([])
    }
  }

  async function refresh() {
    try {
      const [f, s, settings] = await Promise.all([
        api<any>('/api/files'),
        api<any>('/api/schedule'),
        api<any>('/api/settings'),
      ])
      if (f.ok) setFiles(f.files)
      if (s.ok) setSchedules(s.schedules)
      if (settings.ok) {
        setServerSettings(prev => ({ ...prev, ...settings.settings }))
      }
      loadPlayers()
    } catch (e) {
      // ignore
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (!password.trim()) {
        toast.error('Password is required')
        return
      }
      const res = await fetch('/api/auth/login', { 
        method: 'POST', 
        body: JSON.stringify({ password }), 
        headers: { 'content-type': 'application/json' } 
      })
      
      // Enhanced JSON parsing with proper error handling
      let data
      try {
        data = await res.json()
      } catch (jsonErr) {
        const text = await res.clone().text().catch(() => 'Unable to read response')
        console.error('Login: JSON parse failed:', { status: res.status, text: text.substring(0, 200), error: jsonErr })
        throw new Error(`Server returned invalid response. Status: ${res.status}`)
      }
      
      if (!res.ok || !data.ok) throw new Error(data.error || 'Login failed')
      localStorage.setItem('signage_token', data.token)
      setToken(data.token)
      toast.success('Logged in')
      await refresh()
    } catch (e: any) {
      toast.error(e.message || 'Login error')
    }
  }

  async function uploadFile() {
    const f = fileInputRef.current?.files?.[0]
    if (!f) return toast.error('Choose a file')
    handleFiles([f])
  }

  // Drag & Drop handlers
  function onDragEnter(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++
    setDragActive(true)
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--
    if (dragCounter.current <= 0) setDragActive(false)
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0
    setDragActive(false)
    const files = Array.from(e.dataTransfer?.files || [])
    if (!files.length) return
    handleFiles(files)
  }

  function handleFiles(files: File[]) {
    const allowed = [/^image\//, /^video\//]
    const toUpload = files.filter(f => allowed.some(rx => rx.test(f.type)))
    const skipped = files.length - toUpload.length
    if (skipped > 0) toast.message(`Skipped ${skipped} unsupported file(s)`) // images/videos only
    for (const f of toUpload) uploadWithProgress(f)
  }

  function uploadWithProgress(file: File) {
    const itemId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setUploadItems(prev => [{ id: itemId, name: file.name, progress: 0, status: 'uploading' }, ...prev])

    const fd = new FormData()
    fd.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files', true)
    xhr.setRequestHeader('authorization', `Bearer ${getToken()}`)

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return
      const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100))
      setUploadItems(prev => prev.map(u => u.id === itemId ? { ...u, progress: pct } : u))
    }

    xhr.onload = async () => {
      try {
        // Enhanced JSON parsing for upload response
        let res
        try {
          res = JSON.parse(xhr.responseText || '{}')
        } catch (jsonErr) {
          console.error('Upload response: JSON parse failed:', { 
            status: xhr.status, 
            response: (xhr.responseText || '').substring(0, 200), 
            error: jsonErr 
          })
          throw new Error(`Server returned invalid response. Status: ${xhr.status}`)
        }
        
        if (xhr.status === 401) {
          announceUnauthorized()
          throw new Error('Unauthorized - please login again')
        }
        if (xhr.status >= 400 || !res?.ok) throw new Error(res?.error || 'Upload failed')
        setUploadItems(prev => prev.map(u => u.id === itemId ? { ...u, progress: 100, status: 'done' } : u))
        // Auto-select the newly uploaded item so the duration UI and button text update instantly
        if (res?.file?.id) {
          try { setSelectedFileId(res.file.id) } catch {}
          // Immediately schedule using provided duration
          try {
            const mime = res?.file?.mime || file.type || ''
            await scheduleImmediately(res.file.id, mime, uploadDurationSeconds)
          } catch {}
        }
        // refresh lists and notify players
        await refresh()
        try { await broadcast({ type: 'refresh' }) } catch {}
      } catch (err: any) {
        setUploadItems(prev => prev.map(u => u.id === itemId ? { ...u, status: 'error', error: err?.message || 'Upload error' } : u))
        toast.error(err?.message || 'Upload error')
      }
    }

    xhr.onerror = () => {
      setUploadItems(prev => prev.map(u => u.id === itemId ? { ...u, status: 'error', error: 'Network error' } : u))
      toast.error('Network error during upload')
    }

    xhr.send(fd)
  }

  // Add external link (JSON POST)
  async function addExternalLink() {
    if (!linkUrl.trim()) return toast.error('Enter a valid URL')
    
    let processedUrl = linkUrl.trim()
    let processedName = linkName.trim()
    
    // Process YouTube URLs for better user experience
    if (processedUrl.includes('youtube.com/watch') || processedUrl.includes('youtu.be/')) {
      if (!processedName) {
        processedName = 'YouTube Video'
      }
      toast.success('YouTube URL detected - will be optimized for playback')
    }
    
    const dur = parseInt(linkDurationSeconds || '0', 10)
    if (!Number.isFinite(dur) || dur <= 0) {
      return toast.error('Enter duration (in seconds) for the link')
    }
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${getToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ 
          url: processedUrl, 
          name: processedName || undefined, 
          durationSeconds: dur 
        }),
      })
      if (res.status === 401) { announceUnauthorized(); throw new Error('Unauthorized - please login again') }
      
      // Enhanced JSON parsing with proper error handling
      let data
      try {
        data = await res.json()
      } catch (jsonErr) {
        const text = await res.clone().text().catch(() => 'Unable to read response')
        console.error('AddExternalLink: JSON parse failed:', { status: res.status, text: text.substring(0, 200), error: jsonErr })
        throw new Error(`Server returned invalid response. Status: ${res.status}`)
      }
      
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to add link')
      toast.success('Link added and ready for playback')
      setLinkName(''); setLinkUrl('')
      setSelectedFileId(data.file.id)
      // Prefill schedule duration with the link duration and reset link input
      setDurationSeconds(String(dur))
      setLinkDurationSeconds('')
      // Immediately schedule the link using specified duration
      try { await scheduleImmediately(data.file.id, data?.file?.mime || 'link/url', dur) } catch {}
      await refresh()
      await broadcast({ type: 'refresh' })
    } catch (e: any) {
      toast.error(e.message || 'Add link error')
    }
  }

  async function removeFile(id: string) {
    try {
      const res = await fetch(`/api/files/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${getToken()}` } })
      if (res.status === 401) { announceUnauthorized(); throw new Error('Unauthorized - please login again') }
      
      // Enhanced JSON parsing with proper error handling
      let data
      try {
        data = await res.json()
      } catch (jsonErr) {
        const text = await res.clone().text().catch(() => 'Unable to read response')
        console.error('RemoveFile: JSON parse failed:', { status: res.status, text: text.substring(0, 200), error: jsonErr })
        throw new Error(`Server returned invalid response. Status: ${res.status}`)
      }
      
      if (!res.ok || !data.ok) throw new Error(data.error || 'Delete failed')
      toast.success('Deleted')
      await refresh()
      await broadcast({ type: 'refresh' })
      await broadcast({ type: 'command', action: 'stop' })
    } catch (e: any) {
      toast.error(e.message || 'Delete error')
    }
  }

  // Player control helpers
  async function sendCommand(action: string, value?: string | number) {
    const payload: any = { type: 'command', action, ...(value !== undefined ? { value } : {}) }
    // Fire via WS (with internal fallback)
    await broadcast(payload)
    // Also POST to HTTP fallback so players polling receive it even if WS fails
    try {
      fetch('/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    } catch {}
  }

  // Update server settings
  async function updateServerSettings(updates: Partial<typeof serverSettings>) {
    try {
      const res = await api<any>('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        setServerSettings(prev => ({ ...prev, ...updates }))
        toast.success('Settings updated')
        // Broadcast to players
        await broadcast({ type: 'refresh' })
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update settings')
    }
  }

  // Immediately create a schedule for a newly created file/link using the specified duration
  async function scheduleImmediately(fileId: string, mime: string, durInput?: string | number) {
    try {
      const now = Date.now()
      const plus1h = now + 3600_000
      const isVideo = !!mime?.startsWith('video/')
      const isImage = !!mime?.startsWith('image/')
      const isLink = !!mime?.startsWith('link/')
      const dur = typeof durInput === 'number' ? durInput : parseInt(String(durInput || '0'), 10)

      // Enhanced duration validation with override system
      if ((isVideo || isLink) && (!Number.isFinite(dur) || dur <= 0)) {
        toast.error(`Enter duration (seconds) before uploading ${isVideo ? 'videos' : 'links'} - required to override defaults`)
        return
      }
      
      console.log(`Admin: Immediate schedule - ${isVideo ? 'Video' : isLink ? 'Link' : 'Image'} with duration ${dur}s ${dur > 0 ? '(overrides defaults)' : '(uses global default)'}`)

      const payload: any = {
        fileId,
        startAt: now,
        endAt: plus1h,
        order: 0,
      }
      if (Number.isFinite(dur) && dur > 0) payload.durationSeconds = dur

      await api<any>('/api/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      toast.success('Uploaded and scheduled')
      await refresh()
      await broadcast({ type: 'refresh' })
    } catch (e: any) {
      toast.error(e?.message || 'Failed to auto-schedule')
    }
  }

  async function addSchedule() {
    if (!selectedFileId) return toast.error('Select a file')
    // Guard against stale IDs (e.g., server reset)
    let fileExists = files.some(f => f.id === selectedFileId)
    if (!fileExists) {
      await refresh()
      fileExists = files.some(f => f.id === selectedFileId)
      if (!fileExists) {
        return toast.error('Selected content no longer exists. Please choose another file.')
      }
    }
    try {
      // Basic time validation when both provided
      if (startAt && endAt) {
        const s = new Date(startAt).getTime()
        const e = new Date(endAt).getTime()
        if (!Number.isFinite(s) || !Number.isFinite(e)) {
          return toast.error('Invalid start/end date')
        }
        if (e <= s) {
          return toast.error('End time must be after start time')
        }
      }
      // Validate daily time window when not all-day
      if (!allDay) {
        const toMin = (t: string) => {
          const [h, m] = t.split(":").map(Number)
          return (h || 0) * 60 + (m || 0)
        }
        const sMin = toMin(startTime)
        const eMin = toMin(endTime)
        if (eMin <= sMin) {
          return toast.error('End time must be after start time for daily window')
        }
      }
      const payload: any = {
        fileId: selectedFileId,
        startAt: startAt ? new Date(startAt).getTime() : Date.now(),
        endAt: endAt ? new Date(endAt).getTime() : Date.now() + 3600_000,
        order,
      }
      // include day/time UX selections
      if (days.length) payload.days = days
      if (!allDay) {
        payload.startTime = startTime
        payload.endTime = endTime
      }
      // include/enforce per-item duration (seconds) with enhanced validation
      const dur = parseInt(durationSeconds || '0', 10)
      if (isSelectedLink) {
        // Links: duration is mandatory and will override global defaults
        if (Number.isNaN(dur) || dur <= 0) {
          return toast.error('Enter duration (seconds) for this link - required to override global defaults')
        }
        payload.durationSeconds = dur
        console.log(`Admin: Link scheduled with duration override: ${dur}s (global default: ${serverSettings.defaultLinkDuration}s)`)
      } else if (isSelectedVideo) {
        // Videos: duration is mandatory and will override natural video length
        if (Number.isNaN(dur) || dur <= 0) {
          return toast.error('Enter duration (seconds) for this video - required to override natural video duration')
        }
        payload.durationSeconds = dur
        console.log(`Admin: Video scheduled with duration override: ${dur}s (will override natural video duration)`)
      } else {
        // Images: optional duration that overrides global defaults
        if (!Number.isNaN(dur) && dur > 0) {
          payload.durationSeconds = dur
          console.log(`Admin: Image scheduled with duration override: ${dur}s (global default: ${serverSettings.defaultImageDuration}s)`)
        } else {
          console.log(`Admin: Image scheduled using global default: ${serverSettings.defaultImageDuration}s`)
        }
      }
      const data = await api<any>('/api/schedule', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } })
      toast.success('Scheduled')
      // Reset inputs to sensible defaults (now .. +1h)
      try {
        const pad = (n: number) => String(n).padStart(2, '0')
        const toLocalInput = (d: Date) => {
          const y = d.getFullYear()
          const m = pad(d.getMonth() + 1)
          const day = pad(d.getDate())
          const h = pad(d.getHours())
          const min = pad(d.getMinutes())
          return `${y}-${m}-${day}T${h}:${min}`
        }
        const now = new Date()
        now.setSeconds(0, 0)
        const plus1h = new Date(now.getTime() + 60 * 60 * 1000)
        setStartAt(toLocalInput(now))
        setEndAt(toLocalInput(plus1h))
      } catch {
        setStartAt(''); setEndAt('')
      }
      setOrder(0); setDays([])
      await refresh()
      await broadcast({ type: 'refresh' })
    } catch (e: any) {
      toast.error(e.message || 'Schedule error')
    }
  }

  async function deleteSchedule(id: string) {
    try {
      const res = await fetch(`/api/schedule?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${getToken()}` } })
      if (res.status === 401) { announceUnauthorized(); throw new Error('Unauthorized - please login again') }
      
      // Enhanced JSON parsing with proper error handling
      let data
      try {
        data = await res.json()
      } catch (jsonErr) {
        const text = await res.clone().text().catch(() => 'Unable to read response')
        console.error('DeleteSchedule: JSON parse failed:', { status: res.status, text: text.substring(0, 200), error: jsonErr })
        throw new Error(`Server returned invalid response. Status: ${res.status}`)
      }
      
      if (!res.ok || !data.ok) throw new Error(data.error || 'Delete failed')
      toast.success('Removed')
      await refresh()
      await broadcast({ type: 'refresh' })
    } catch (e: any) {
      toast.error(e.message || 'Remove error')
    }
  }

  const fileOptions = useMemo(() => files.map((f) => ({ value: f.id, label: f.name })), [files])
  // Determine currently selected file and whether it's a link
  const selectedFile = useMemo(() => files.find((f) => f.id === selectedFileId) || null, [files, selectedFileId])
  const isSelectedLink = !!selectedFile?.mime?.startsWith('link/')
  const isSelectedVideo = !!selectedFile?.mime?.startsWith('video/')
  const isSelectedImage = !!selectedFile?.mime?.startsWith('image/')
  const scheduleButtonText = isSelectedVideo
    ? 'Add Video to Schedule'
    : isSelectedLink
    ? 'Add Link to Schedule'
    : isSelectedImage
    ? 'Add Image to Schedule'
    : 'Add to Schedule'
  
  function toggleDay(n: number) {
    setDays((prev) => prev.includes(n) ? prev.filter(d => d !== n) : [...prev, n])
  }

  async function changePassword() {
    try {
      const res = await api<any>('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oldPassword: oldAdminPass, newPassword: newAdminPass }) })
      const data = res
      if (!data.ok) throw new Error(data.error || 'Failed')
      toast.success(data.reset ? 'Password reset to default' : 'Password changed')
      setOldAdminPass(''); setNewAdminPass('')
    } catch (e: any) {
      toast.error(e.message || 'Password error')
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => toast.success('Link copied')).catch(() => toast.error('Copy failed'))
  }

  // Compute active playlist similar to player to show a Now Playing (predicted) strip
  const activePlaylist = useMemo(() => {
    const now = Date.now()
    const day = new Date(now).getDay()
    const mins = new Date(now).getHours() * 60 + new Date(now).getMinutes()
    const inTimeWindow = (start?: string, end?: string) => {
      if (!start && !end) return true
      const toMin = (t: string) => {
        const [h, m] = t.split(":" ).map(Number); return h * 60 + (m || 0)
      }
      const s = start ? toMin(start) : 0
      const e = end ? toMin(end) : 24 * 60
      return mins >= s && mins <= e
    }
    return (schedules || [])
      .filter(s => now >= s.startAt && now <= s.endAt)
      .filter((s: any) => (Array.isArray(s.days) ? s.days.includes(day) : true))
      .filter((s: any) => inTimeWindow((s as any).startTime, (s as any).endTime))
      .sort((a: any, b: any) => a.order - b.order)
  }, [schedules])

  const predictedNowPlaying = useMemo(() => {
    // If nothing scheduled, default to first uploaded file
    const item: any = activePlaylist[0]
    if (item) return files.find(f => f.id === item.fileId) || null
    return files[0] || null
  }, [activePlaylist, files])

  // Reset per-item duration input whenever selection changes to avoid stale values
  useEffect(() => {
    setDurationSeconds('')
  }, [selectedFileId])

  if (!token) {
    return (
      <main className="container mx-auto max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Admin Login</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={login} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter admin password" />
              </div>
              <Button type="submit" className="w-full">Login</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main
      className="container mx-auto p-6 space-y-8"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold">Digital Signage Admin</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { localStorage.removeItem('signage_token'); setToken('') }}>Logout</Button>
          <Button onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Upload Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input type="file" ref={fileInputRef} accept="image/*,video/*" />
            {/* Duration for immediate scheduling on upload */}
            <div className="space-y-1">
              <Input
                type="number"
                min={1}
                placeholder="Duration (seconds) — OVERRIDES global defaults"
                value={uploadDurationSeconds}
                onChange={(e) => setUploadDurationSeconds(e.target.value.replace(/[^0-9]/g, ''))}
              />
              <span className="text-xs text-muted-foreground">After upload, the item will be scheduled immediately using this duration. <strong>This overrides any global default settings.</strong></span>
            </div>
            <Button onClick={uploadFile}>Upload + Schedule</Button>
            <p className="text-sm text-muted-foreground">Allowed: Images and Videos up to 100MB. The file link will be available below.</p>
            {/* External Link Adder */}
            <Separator className="my-2" />
            <div className="space-y-2">
              <Label>Add External Link</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Optional name (e.g. YouTube Page)" value={linkName} onChange={(e) => setLinkName(e.target.value)} />
                <Input placeholder="https://example.com/page or YouTube URL" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Input
                  type="number"
                  min={1}
                  placeholder="Duration (seconds) — OVERRIDES global defaults"
                  value={linkDurationSeconds}
                  onChange={(e) => setLinkDurationSeconds(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <span className="text-xs text-muted-foreground">The link will play exactly for this many seconds. <strong>This overrides any global default settings.</strong></span>
                <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded space-y-1">
                  <div><strong>YouTube Support:</strong> Regular YouTube URLs (youtube.com/watch or youtu.be) will be automatically converted to embeddable format.</div>
                  <div><strong>Best Practice:</strong> For maximum compatibility, use direct embed URLs:</div>
                  <div className="font-mono text-xs bg-white p-1 rounded">https://www.youtube.com/embed/VIDEO_ID</div>
                  <div>You can get this from YouTube's "Share" → "Embed" option.</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addExternalLink}>Add Link + Schedule</Button>
                <span className="text-xs text-muted-foreground">Links will play on the player like other items.</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select File</Label>
              <Select value={selectedFileId} onValueChange={setSelectedFileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose content" />
                </SelectTrigger>
                <SelectContent>
                  {fileOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date range window - only required when not all-day */}
            {!allDay && (
              <div className="space-y-2">
                <Label>Active Window</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Start At</span>
                    <Input
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">End At</span>
                    <Input
                      type="datetime-local"
                      value={endAt}
                      onChange={(e) => setEndAt(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Content will only run between these dates (local time).</p>
              </div>
            )}

            {/* Days of week */}
            <div className="space-y-2">
              <Label>Days</Label>
              <div className="flex flex-wrap gap-2">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, idx) => (
                  <button key={idx} type="button" onClick={() => toggleDay(idx)} className={`px-3 py-1 rounded border text-sm ${days.includes(idx) ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>{d}</button>
                ))}
              </div>
            </div>

            {/* Time window */}
            <div className="space-y-2">
              <Label>Time Window</Label>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
                </label>
                {!allDay && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Start</span>
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-28" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">End</span>
                      <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-28" />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Order</Label>
              <Input type="number" value={order} onChange={(e) => setOrder(parseInt(e.target.value || '0', 10))} />
            </div>
            {/* Per-item mute for videos - REMOVED due to browser policies */}
            {/* Video duration control: exact override for specified duration */}
            {isSelectedVideo && (
              <div className="space-y-2">
                <Label>Duration (seconds) — OVERRIDES natural video duration</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 30"
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <p className="text-xs text-muted-foreground"><strong>Videos will be forced to play for exactly the specified duration, ignoring natural video length.</strong></p>
              </div>
            )}
            {/* Per-item duration for links (required) */}
            {isSelectedLink && (
              <div className="space-y-2">
                <Label>Duration (seconds) — OVERRIDES global link defaults</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 10"
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <p className="text-xs text-muted-foreground"><strong>Links will be forced to play for exactly the specified duration, overriding global defaults.</strong></p>
              </div>
            )}
            {/* Optional duration for images */}
            {isSelectedImage && (
              <div className="space-y-2">
                <Label>Duration (seconds) — OVERRIDES global image defaults</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 8 (leave empty to use global default)"
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <p className="text-xs text-muted-foreground"><strong>If provided, the image will display for exactly this many seconds, overriding global defaults. Leave blank to use the global image duration setting.</strong></p>
              </div>
            )}
            <Button className="w-full sm:w-auto" onClick={addSchedule}>{scheduleButtonText}</Button>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Live Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Live Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                try {
                  const win = previewIframeRef.current?.contentWindow
                  win?.postMessage({ type: 'hard_refresh' }, '*')
                  console.log('Admin: Sent hard refresh to preview')
                } catch (err) {
                  console.error('Admin: Failed to send hard refresh:', err)
                }
              }}
            >
              Hard Refresh
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                try {
                  const win = previewIframeRef.current?.contentWindow
                  win?.postMessage({ type: 'request_state' }, '*')
                  console.log('Admin: Requested state from preview')
                  
                  // Also request immediate sync of settings
                  setTimeout(() => {
                    win?.postMessage({ type: 'sync_settings', settings: serverSettings }, '*')
                  }, 100)
                } catch (err) {
                  console.error('Admin: Failed to sync preview:', err)
                }
              }}
            >
              🔄 Sync Preview
            </Button>
          </div>
          <div className="w-full aspect-video bg-black rounded overflow-hidden">
            <iframe
              key={previewKey}
              ref={previewIframeRef}
              src="/player"
              className="w-full h-full border-0"
              allow="autoplay; fullscreen; picture-in-picture"
            />
          </div>
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1">
              <span className={`h-2 w-2 rounded-full ${
                previewConnectionStatus === 'connected' ? 'bg-green-500' : 
                previewConnectionStatus === 'disconnected' ? 'bg-red-500' : 'bg-yellow-500'
              }`} />
              {previewConnectionStatus === 'connected' ? 'Connected' : 
               previewConnectionStatus === 'disconnected' ? 'Disconnected' : 'Connecting'}
            </span>
            
            <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1">
              <span className={`h-2 w-2 rounded-full ${livePreviewPowered ? 'bg-green-500' : 'bg-zinc-400'}`} />
              {livePreviewPowered ? 'Powered On' : 'Powered Off'}
            </span>
            
            {livePreviewIsRefreshing && (
              <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 text-blue-700 px-3 py-1">
                🔄 Refreshing
              </span>
            )}
            
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Now Playing:</span>
                <span className="font-medium truncate max-w-[200px]">
                  {livePreviewNowPlaying || predictedNowPlaying?.name || '—'}
                </span>
              </div>
              
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Item {livePreviewActiveIndex + 1} of {livePreviewDisplayListLength || 'N/A'}</span>
                <span>{livePreviewTotalFiles} files</span>
                <span>{livePreviewTotalSchedules} schedules</span>
                <span>Auto-start: {livePreviewAutoStartEnabled ? (
                  livePreviewHasAutoStarted ? '✅ Started' : '🟡 Ready'
                ) : '❌ Disabled'}</span>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground bg-gray-50 p-3 rounded space-y-1">
            <div><strong>Live Preview Status:</strong> This preview mirrors the player in real-time with enhanced sync.</div>
            <div><strong>Connection:</strong> {previewConnectionStatus === 'connected' ? 'Active real-time sync' : previewConnectionStatus === 'disconnected' ? 'Sync lost - try Hard Refresh' : 'Establishing connection'}</div>
            <div><strong>Last Update:</strong> {new Date(livePreviewLastUpdate).toLocaleTimeString()}</div>
            <div><strong>Sync Controls:</strong> Use "Sync Preview" for immediate state sync, "Hard Refresh" to reload the preview completely.</div>
          </div>
        </CardContent>
      </Card>

      {/* Active Players (moved after Live Preview) */}
      {players.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Active players:</span>
          {players.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="font-medium">{p.name}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No active players detected.</div>
      )}

      {/* Player Controls (moved below live preview) */}
      <Card>
        <CardHeader>
          <CardTitle>Player Controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => sendCommand('power', 'on')}>Power On</Button>
            <Button size="sm" variant="destructive" onClick={() => sendCommand('power', 'off')}>Power Off</Button>
            <Button size="sm" onClick={() => sendCommand('orientation', 'landscape')}>Landscape</Button>
            <Button size="sm" onClick={() => sendCommand('orientation', 'portrait')}>Portrait</Button>
            <Button size="sm" variant="secondary" onClick={() => { broadcast({ type: 'refresh' }); try { previewIframeRef.current?.contentWindow?.postMessage({ type: 'hard_refresh' }, '*') } catch {} }}>Force Refresh</Button>
            <Button size="sm" variant="secondary" onClick={() => sendCommand('stop')}>Stop Playback</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-1">
            <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
              <strong>Pro Tip:</strong> Audio controls have been removed due to browser autoplay policies. Content will play with browser default audio settings.
            </div>
          </div>
          {/* removed non-working Previous/Next controls */}
          {/* Brightness control only */}
          <div className="grid gap-3 sm:grid-cols-1">
            <div className="space-y-1">
              <Label htmlFor="brightness-range">Brightness: {bright}%</Label>
              <input
                id="brightness-range"
                type="range"
                min={0}
                max={200}
                value={bright}
                onMouseDown={() => { isDraggingBrightRef.current = true }}
                onTouchStart={() => { isDraggingBrightRef.current = true }}
                onMouseUp={() => { isDraggingBrightRef.current = false }}
                onTouchEnd={() => { isDraggingBrightRef.current = false }}
                onChange={(e) => { const v = Number(e.target.value); suppressBrightUntilRef.current = Date.now() + 1200; setBright(v); sendCommand('brightness', v); }}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex items-center">
            <a className="text-sm underline text-muted-foreground ml-auto" href="/player" target="_blank" rel="noreferrer">Open Player</a>
          </div>
        </CardContent>
      </Card>

      {/* Server Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Server Settings</CardTitle>
          <p className="text-sm text-muted-foreground">Configure default player behavior and persistent settings</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="autoStart"
                  checked={serverSettings.autoStart}
                  onChange={(e) => updateServerSettings({ autoStart: e.target.checked })}
                />
                <Label htmlFor="autoStart">Auto-start playback when content is available</Label>
              </div>
              
              <div className="space-y-2">
                <Label>Default Orientation</Label>
                <select
                  value={serverSettings.orientation}
                  onChange={(e) => updateServerSettings({ orientation: e.target.value as 'landscape' | 'portrait' })}
                  className="w-full px-3 py-2 border rounded"
                >
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                </select>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Default Brightness: {serverSettings.brightness}%</Label>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={serverSettings.brightness}
                  onChange={(e) => updateServerSettings({ brightness: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Default Image Duration (seconds)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={serverSettings.defaultImageDuration}
                    onChange={(e) => updateServerSettings({ defaultImageDuration: Number(e.target.value) || 10 })}
                  />
                  <p className="text-xs text-muted-foreground">Used when no specific duration is provided for images.</p>
                </div>
                <div className="space-y-2">
                  <Label>Default Link Duration (seconds)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={serverSettings.defaultLinkDuration}
                    onChange={(e) => updateServerSettings({ defaultLinkDuration: Number(e.target.value) || 30 })}
                  />
                  <p className="text-xs text-muted-foreground">Used when no specific duration is provided for links.</p>
                </div>
              </div>
              
              <div className="text-xs text-yellow-600 bg-yellow-50 p-3 rounded">
                <strong>Duration Override Priority:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-1">
                  <li><strong>Schedule duration</strong> (highest priority)</li>
                  <li><strong>File-specific duration</strong> (medium priority)</li>
                  <li><strong>Global defaults above</strong> (lowest priority)</li>
                </ol>
                <p className="mt-2">When a duration is specified anywhere (upload, link creation, scheduling), it will completely override these global defaults.</p>
              </div>
            </div>
          </div>
          
          <div className="text-xs text-muted-foreground bg-blue-50 p-3 rounded">
            <strong>Persistent Storage:</strong> All settings, files, and schedules are automatically saved to disk and restored on server restart. 
            Files are stored in a cross-platform data directory with proper Linux compatibility.
          </div>
        </CardContent>
      </Card>

      {/* Drag & Drop Overlay */}
      {dragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="mx-6 w-full max-w-2xl rounded-lg border-2 border-dashed border-primary bg-card/80 p-10 text-center animate-in zoom-in-50">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <UploadCloud className="h-6 w-6 text-primary" />
            </div>
            <p className="text-lg font-medium">Drop files anywhere to upload</p>
            <p className="text-sm text-muted-foreground mt-1">Images and videos up to 100MB. Uploads start immediately.</p>
          </div>
        </div>
      )}

      {/* Upload Progress Tray */}
      {uploadItems.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,380px)] space-y-2">
          {uploadItems.map(u => (
            <div key={u.id} className="rounded-lg border bg-card p-3 shadow-sm">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate font-medium pr-2" title={u.name}>{u.name}</span>
                <span className="tabular-nums text-muted-foreground">{u.progress}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded bg-secondary">
                <div
                  className={`h-full ${u.status === 'error' ? 'bg-destructive' : 'bg-primary'} transition-all`}
                  style={{ width: `${u.progress}%` }}
                />
              </div>
              {u.status === 'error' && (
                <p className="mt-2 text-xs text-destructive">{u.error}</p>
              )}
              {u.status === 'done' && (
                <p className="mt-2 text-xs text-muted-foreground">Uploaded</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {files.length === 0 && <p className="text-sm text-muted-foreground">No files uploaded yet.</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {files.map((f) => (
                <div key={f.id} className="space-y-2">
                  {f.mime.startsWith('image/') && (
                    <img src={f.url} alt={f.name} className="w-full h-32 object-cover rounded pointer-events-none select-none" />
                  )}
                  {f.mime.startsWith('video/') && (
                    <video src={f.url} muted autoPlay loop playsInline className="w-full h-32 object-cover rounded pointer-events-none select-none" />
                  )}
                  {f.mime.startsWith('link/') && (
                    <div className="w-full h-32 rounded bg-secondary flex items-center justify-center text-xs text-muted-foreground">
                      External Link
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate" title={f.name}>{f.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <a className="underline" href={f.url} target="_blank" rel="noreferrer">Open link</a>
                    <Button size="sm" variant="secondary" onClick={() => copy(f.url)}>Copy link</Button>
                    <Button size="sm" variant="destructive" onClick={() => removeFile(f.id)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {schedules.length === 0 && <p className="text-sm text-muted-foreground">No scheduled items.</p>}
            <div className="space-y-2">
              {schedules.map((s) => {
                const f = files.find((x) => x.id === s.fileId)
                const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
                const daysLabel = Array.isArray((s as any).days) && (s as any).days.length
                  ? (s as any).days.map((d: number) => dayNames[d] ?? d).join(',')
                  : ''
                return (
                  <div key={s.id} className="flex items-center justify-between gap-2 border rounded p-2">
                    <div className="text-sm">
                      <div className="font-medium">{f?.name || s.fileId}</div>
                      <div className="text-muted-foreground">
                        {new Date(s.startAt).toLocaleString()} → {new Date(s.endAt).toLocaleString()} • Order {s.order}
                        {daysLabel ? (
                          <span> • Days {daysLabel}</span>
                        ) : null}
                        {(s as any).startTime && (s as any).endTime ? (
                          <span> • Time {(s as any).startTime}-{(s as any).endTime}</span>
                        ) : null}
                        {(s as any).durationSeconds ? (
                          <span className="text-blue-600 font-medium"> • Duration Override: {(s as any).durationSeconds}s</span>
                        ) : null}
                      </div>
                    </div>
                    <Button size="sm" variant="destructive" onClick={() => deleteSchedule(s.id)}>Remove</Button>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Admin Password */}
      <Card>
        <CardHeader>
          <CardTitle>Admin Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Current Password (or enter "anjuman" to reset)</Label>
              <Input type="password" value={oldAdminPass} onChange={(e) => setOldAdminPass(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input type="password" value={newAdminPass} onChange={(e) => setNewAdminPass(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={changePassword}>Update</Button>
            <Button variant="secondary" onClick={async () => {
              try {
                const res = await api<any>('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oldPassword: 'Anjuman' }) })
                if (res?.ok) toast.success('Password reset to default (aiarkp@123)')
              } catch { toast.error('Reset failed') }
            }}>Reset to Default</Button>
          </div>
        </CardContent>
      </Card>

      {/* Links Section */}
      <Card>
        <CardHeader>
          <CardTitle>Links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              {files.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 p-2 border rounded">
                  <div className="flex-1">
                    <p className="text-sm font-medium truncate" title={f.name}>{f.name}</p>
                    <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline break-all">{f.url}</a>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => copy(f.url)}>Copy</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}