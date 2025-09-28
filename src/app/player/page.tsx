'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// detect if running inside an iframe (admin Live Preview)
const isPreview = typeof window !== 'undefined' && window.self !== window.top

// Enhanced Link Player Component that handles YouTube and other video services
function EnhancedLinkPlayer({ url, name }: { url: string; name: string }) {
  const [embedUrl, setEmbedUrl] = useState(url)
  const [playerType, setPlayerType] = useState<'iframe' | 'youtube' | 'other'>('iframe')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  
  useEffect(() => {
    // Detect and convert YouTube URLs to embeddable format
    if (url.includes('youtube.com/watch') || url.includes('youtu.be/') || url.includes('youtube.com/embed/')) {
      let videoId = ''
      
      if (url.includes('youtube.com/watch')) {
        const match = url.match(/[?&]v=([^&]+)/)
        videoId = match ? match[1] : ''
      } else if (url.includes('youtu.be/')) {
        const match = url.match(/youtu\.be\/([^?&]+)/)
        videoId = match ? match[1] : ''
      } else if (url.includes('youtube.com/embed/')) {
        const match = url.match(/youtube\.com\/embed\/([^?&]+)/)
        videoId = match ? match[1] : ''
      }
      
      if (videoId) {
        // Use YouTube's embed URL with enhanced parameters to bypass restrictions
        const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&controls=1&modestbranding=1&rel=0&iv_load_policy=3&fs=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`
        setEmbedUrl(embedUrl)
        setPlayerType('youtube')
        return
      }
    }
    
    // Check for other video services
    if (url.includes('vimeo.com/')) {
      const match = url.match(/vimeo\.com\/(\d+)/)
      if (match) {
        const videoId = match[1]
        const embedUrl = `https://player.vimeo.com/video/${videoId}?autoplay=1&muted=1&controls=0&loop=1`
        setEmbedUrl(embedUrl)
        setPlayerType('other')
        return
      }
    }
    
    if (url.includes('dailymotion.com/')) {
      const match = url.match(/dailymotion\.com\/video\/([^_]+)/)
      if (match) {
        const videoId = match[1]
        const embedUrl = `https://www.dailymotion.com/embed/video/${videoId}?autoplay=1&mute=1&controls=0`
        setEmbedUrl(embedUrl)
        setPlayerType('other')
        return
      }
    }
    
    // Default fallback for other URLs
    setEmbedUrl(url)
    setPlayerType('iframe')
  }, [url])
  
  // Handle mute commands for YouTube iframes via postMessage
  useEffect(() => {
    const handleMute = (event: MessageEvent) => {
      if (playerType === 'youtube' && iframeRef.current) {
        try {
          // Send mute/unmute commands to YouTube iframe
          const command = event.data?.action === 'mute' ? 'pauseVideo' : 'playVideo'
          iframeRef.current.contentWindow?.postMessage(
            `{"event":"command","func":"${command}","args":[]}`,
            'https://www.youtube.com'
          )
        } catch {}
      }
    }
    
    window.addEventListener('message', handleMute)
    return () => window.removeEventListener('message', handleMute)
  }, [playerType])
  
  // For YouTube, use enhanced iframe attributes based on your working example
  if (playerType === 'youtube') {
    return (
      <iframe
        ref={iframeRef}
        key={`youtube-${url}`}
        width="100%"
        height="100%"
        src={embedUrl}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="w-full h-full border-0"
        style={{
          border: 'none',
          outline: 'none',
          background: 'black',
          width: '100%',
          height: '100%'
        }}
        loading="eager"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    )
  }
  
  // For other video services
  if (playerType === 'other') {
    return (
      <iframe
        key={`video-${url}`}
        src={embedUrl}
        className="w-full h-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        title={`Video: ${name}`}
      />
    )
  }
  
  // Default iframe for other content
  return (
    <iframe
      key={`link-${url}`}
      src={embedUrl}
      className="w-full h-full border-0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      title={name}
    />
  )
}

type FileItem = {
  id: string
  name: string
  mime: string
  url: string
  durationSeconds?: number // Add optional duration for files
}

type ScheduleItem = {
  id: string
  fileId: string
  startAt: number
  endAt: number
  order: number
  // optional
  days?: number[]
  startTime?: string
  endTime?: string
  durationSeconds?: number
  // add per-item mute support
  muted?: boolean
}

export default function PlayerPage() {
  const [files, setFiles] = useState<FileItem[]>([])
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [currentCredit, setCurrentCredit] = useState(0)
  // Add server settings state for duration defaults
  const [serverSettings, setServerSettings] = useState({
    autoStart: true,
    brightness: 100,
    orientation: 'landscape' as 'landscape' | 'portrait',
    defaultImageDuration: 10,
    defaultLinkDuration: 30,
  })
  const wsRef = useRef<WebSocket | null>(null)
  const videoARef = useRef<HTMLVideoElement | null>(null)
  const videoBRef = useRef<HTMLVideoElement | null>(null)
  const [activeVideoTag, setActiveVideoTag] = useState<'A' | 'B'>('A')
  const getActiveVideo = () => (activeVideoTag === 'A' ? videoARef.current : videoBRef.current)
  const getIdleVideo = () => (activeVideoTag === 'A' ? videoBRef.current : videoARef.current)
  const [powered, setPowered] = useState(true)
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(() => (typeof window !== 'undefined' && (localStorage.getItem('player_orientation') as any)) || 'landscape')
  // Auto-start feature - start playback immediately when content is available
  const [autoStartEnabled, setAutoStartEnabled] = useState(true)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)
  // New: advance timer ref
  const advanceTimerRef = useRef<number | null>(null)
  // New: brightness only (volume/mute removed due to browser policies)
  const [brightness, setBrightness] = useState<number>(() => {
    if (typeof window === 'undefined') return 100
    const v = Number(localStorage.getItem('player_brightness') || '100')
    return Number.isFinite(v) ? Math.max(0, Math.min(200, v)) : 100
  })
  // Audio context removed - no longer needed due to browser policy limitations
  // New: last applied command timestamp for HTTP fallback polling
  const lastCmdTsRef = useRef<number>((() => {
    try {
      const stored = localStorage.getItem('player_last_cmd_ts')
      return stored ? Number(stored) || Date.now() : Date.now()
    } catch {
      return Date.now()
    }
  })())
  // NEW: visible refresh overlay state
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  // NEW: throttle refreshes to prevent rapid successive refreshes
  const lastRefreshTimeRef = useRef<number>(0)

  // Audio context and volume override helpers removed due to browser policies

  // Helper: safe autoplay across browsers (simplified without mute/volume controls)
  function safePlay(video: HTMLVideoElement | null) {
    if (!video) return
    
    // Always start muted to satisfy browser autoplay policies
    video.muted = true
    video.volume = 1
    
    try {
      const p = video.play()
      if (p && typeof p.then === 'function') {
        p.then(() => {
          // Playback started successfully - leave muted due to browser policies
        }).catch(() => {
          // Fallback: ensure muted playback
          video.muted = true
          video.volume = 1
          video.play().catch(() => {})
        })
      }
    } catch {
      // Last resort: force muted
      video.muted = true
      video.volume = 1
      video.play().catch(() => {})
    }
  }

  // helper to persist last command timestamp
  const setLastCmdTs = (ts: number) => {
    lastCmdTsRef.current = ts
    try { localStorage.setItem('player_last_cmd_ts', String(ts)) } catch {}
  }

  // Helper: do a controlled refresh cycle that minimizes disruption
  const doVisibleRefresh = () => {
    // Throttle refreshes - don't allow more than once every 5 seconds
    const now = Date.now()
    if (now - lastRefreshTimeRef.current < 5000) {
      console.log('Player: Refresh throttled (too recent)')
      return
    }
    lastRefreshTimeRef.current = now
    
    console.log('Player: Performing controlled refresh')
    setIsRefreshing(true)
    
    // Only reload if we're not actively playing content
    const shouldReload = !powered || displayList.length === 0
    
    if (shouldReload) {
      console.log('Player: Reloading content (no active playback)')
      load().finally(() => {
        // Brief visual indicator
        window.setTimeout(() => {
          setIsRefreshing(false)
          console.log('Player: Controlled refresh completed')
        }, 500) // Reduced from 700ms
      })
    } else {
      console.log('Player: Skipping content reload (active playback detected)')
      // Just clear the refresh indicator quickly
      window.setTimeout(() => {
        setIsRefreshing(false)
        console.log('Player: Refresh indicator cleared')
      }, 200)
    }
  }

  // Helper: compute current effective mute - removed due to browser policies
  function currentEffectiveMuted() {
    // Always return true due to browser autoplay policies
    return true
  }

  // Reusable command applier for WS + HTTP fallback
  const applyCommand = (msg: any) => {
    if (!msg || msg.type !== 'command') return
    if (msg.action === 'power') {
      const turnOn = msg.value !== 'off'
      setPowered(turnOn)
      if (!turnOn) {
        try { getActiveVideo()?.pause() } catch {}
        // stop any scheduled advances while powered off
        clearAdvanceTimer()
      } else {
        // when powering back on, ensure timers/playback re-initialize
        try { safePlay(getActiveVideo()) } catch {}
        // retrigger media effect to re-arm timers for images/links
        setActiveIndex((idx) => idx)
      }
    }
    if (msg.action === 'orientation') {
      const next = msg.value === 'portrait' ? 'portrait' : 'landscape'
      setOrientation(next)
      try { localStorage.setItem('player_orientation', next) } catch {}
    }
    if (msg.action === 'set_label') {
      try {
        localStorage.setItem('player_label', String(msg.value || ''))
        if (!isPreview) {
          const name = String(msg.value || '') || (navigator.platform || 'Player')
          wsRef.current?.send(JSON.stringify({ type: 'identify', name, ua: navigator.userAgent }))
        }
      } catch {}
    }
    if (msg.action === 'stop') {
      try { getActiveVideo()?.pause() } catch {}
    }
    // Mute/unmute commands removed due to browser policies
    // New: brightness control (0-200 where 100 is normal)
    if (msg.action === 'brightness') {
      const n = Math.max(0, Math.min(200, Number(msg.value)))
      setBrightness(n)
      try { localStorage.setItem('player_brightness', String(n)) } catch {}
    }
    // Next/Previous navigation
    if (msg.action === 'next') {
      advance()
    }
    if (msg.action === 'prev') {
      goPrev()
    }
  }

  const credits = [
    'Made by Gyanesh AO5K',
    'Ayaan AO5K',
    'IBaad AO5K',
    'Huzaifa AO5K',
    'Made for Automation & Robotics Dept.',
    'Under The Guidance Of ',
    'Muslim Rangwala , Sir',
    'Machine Learning IN ROBOTICS (MIR)'
  ]

  useEffect(() => {
    const id = setInterval(() => {
      setCurrentCredit((prev) => (prev + 1) % credits.length)
    }, 2000)
    return () => clearInterval(id)
  }, [credits.length])

  async function load() {
    try {
      console.log('Player: Loading content from server...')
      const [fRes, sRes, settingsRes] = await Promise.all([
        fetch('/api/files'),
        fetch('/api/schedule'),
        fetch('/api/settings'),
      ])
      
      // Enhanced error handling for each response
      let f = null, s = null, settings = null
      
      if (fRes.ok) {
        try {
          f = await fRes.json()
          console.log('Player: Loaded', f?.files?.length || 0, 'files')
        } catch (err) {
          console.error('Player: Failed to parse files response:', err)
        }
      } else {
        console.error('Player: Files API returned', fRes.status, fRes.statusText)
      }
      
      if (sRes.ok) {
        try {
          s = await sRes.json()
          console.log('Player: Loaded', s?.schedules?.length || 0, 'schedules')
        } catch (err) {
          console.error('Player: Failed to parse schedules response:', err)
        }
      } else {
        console.error('Player: Schedule API returned', sRes.status, sRes.statusText)
      }
      
      if (settingsRes.ok) {
        try {
          settings = await settingsRes.json()
          console.log('Player: Loaded settings')
        } catch (err) {
          console.error('Player: Failed to parse settings response:', err)
        }
      } else {
        console.error('Player: Settings API returned', settingsRes.status, settingsRes.statusText)
      }
      
      // Update state only if we got valid data
      if (f?.files) {
        setFiles(f.files)
        console.log('Player: Updated files state with', f.files.length, 'items')
      }
      if (s?.schedules) {
        setSchedules(s.schedules)
        console.log('Player: Updated schedules state with', s.schedules.length, 'items')
      }
      
      // Load server settings - including duration defaults for proper override system
      if (settings?.settings) {
        const loadedSettings = settings.settings
        setAutoStartEnabled(loadedSettings.autoStart ?? true)
        setBrightness(loadedSettings.brightness ?? 100)
        setOrientation(loadedSettings.orientation ?? 'landscape')
        
        // Update server settings state for duration override system
        setServerSettings(prev => ({
          ...prev,
          autoStart: loadedSettings.autoStart ?? true,
          brightness: loadedSettings.brightness ?? 100,
          orientation: loadedSettings.orientation ?? 'landscape',
          defaultImageDuration: loadedSettings.defaultImageDuration ?? 10,
          defaultLinkDuration: loadedSettings.defaultLinkDuration ?? 30,
        }))
        
        console.log('Player: Updated settings - autoStart:', loadedSettings.autoStart, 'brightness:', loadedSettings.brightness, 'defaults:', { image: loadedSettings.defaultImageDuration, link: loadedSettings.defaultLinkDuration })
        
        // Save to localStorage for offline fallback
        try {
          localStorage.setItem('player_brightness', String(loadedSettings.brightness ?? 100))
          localStorage.setItem('player_orientation', loadedSettings.orientation ?? 'landscape')
        } catch {}
      }
      
      console.log('Player: Load completed successfully')
    } catch (err) {
      console.error('Player: Load failed:', err)
      // Don't throw - allow the player to continue with existing state
    }
  }

  useEffect(() => {
    load()

    let reconnectDelay = 1000 // start 1s
    let stopped = false
    let reconnectTimer: number | null = null

    const tryOpenWS = (): WebSocket | null => {
      // Prefer relative path first to avoid proxy/port mismatches in hosted previews/iframes
      try {
        return new WebSocket('/api/ws')
      } catch {}
      // Fallback to absolute URL
      const abs = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws'
      try {
        return new WebSocket(abs)
      } catch {
        return null
      }
    }

    const connect = () => {
      if (stopped) return

      const scheduleReconnect = () => {
        if (stopped) return
        if (reconnectTimer) window.clearTimeout(reconnectTimer)
        reconnectTimer = window.setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000) // max 30s
          connect()
        }, reconnectDelay)
      }

      let ws: WebSocket | null = null
      try {
        ws = tryOpenWS()
        if (!ws) throw new Error('ws-open-failed')
      } catch {
        // schedule reconnect
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        reconnectDelay = 1000 // reset backoff on success
        try {
          if (!isPreview) {
            const label = localStorage.getItem('player_label') || ''
            const name = label || (navigator.platform || 'Player')
            ws?.send(JSON.stringify({ type: 'identify', name, ua: navigator.userAgent }))
          }
        } catch {}
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data))
          console.log('Player: Received WebSocket message:', msg.type)
          
          if (msg.type === 'refresh') { 
            console.log('Player: Refresh command received via WebSocket')
            doVisibleRefresh() 
          }
          if (msg.type === 'command') {
            console.log('Player: Command received via WebSocket:', msg.action)
            applyCommand(msg)
            // record as processed with current time when coming via WS
            setLastCmdTs(Date.now())
          }
          if (msg.type === 'heartbeat') {
            console.log('Player: Heartbeat received')
          }
        } catch (err) {
          console.warn('Player: Failed to parse WebSocket message:', err, e.data)
        }
      }

      ws.onerror = () => {
        // swallow errors, rely on close to retry
      }

      ws.onclose = () => {
        wsRef.current = null
        scheduleReconnect()
      }
    }

    connect()

    // Reduced polling frequency to prevent excessive refreshing
    const pollId = window.setInterval(() => {
      const wsOpen = !!wsRef.current && wsRef.current.readyState === WebSocket.OPEN
      if (!wsOpen) {
        console.log('Player: WebSocket disconnected, using HTTP polling for updates')
        // Only load content if we don't have any or if powered off
        if (displayList.length === 0 || !powered) {
          load()
        }
        
        // fetch and apply any queued commands via HTTP fallback
        const since = lastCmdTsRef.current || Date.now()
        fetch(`/api/commands?since=${encodeURIComponent(String(since))}`)
          .then(r => {
            if (!r.ok) {
              console.warn('Player: Commands API returned', r.status, r.statusText)
              return null
            }
            return r.json()
          })
          .then((data) => {
            if (!data || !data.commands) return
            let maxTs = since
            for (const c of data.commands) {
              if (c && typeof c.ts === 'number' && c.payload) {
                console.log('Player: Applying command from HTTP:', c.payload.action)
                applyCommand(c.payload)
                if (c.ts > maxTs) maxTs = c.ts
              }
            }
            if (maxTs > since) setLastCmdTs(maxTs)
          })
          .catch((err) => {
            console.warn('Player: Failed to fetch commands:', err)
          })
      }
    }, 10000) // Increased from 3s to 10s to reduce excessive polling

    // Controlled refresh events to prevent unexpected refreshing
    const onVisible = () => { 
      if (document.visibilityState === 'visible') {
        // Only refresh if we've been away for more than 30 seconds
        const lastUpdate = Date.now() - (lastCmdTsRef.current || 0)
        if (lastUpdate > 30000) {
          console.log('Player: Tab regained focus after extended absence, refreshing')
          load()
        } else {
          console.log('Player: Tab regained focus, skipping refresh (recent activity)')
        }
      }
    }
    
    const onOnline = () => {
      // Only refresh when coming back online if we don't have content
      if (displayList.length === 0 || !powered) {
        console.log('Player: Network restored, refreshing content')
        load()
      }
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    return () => {
      stopped = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      window.clearInterval(pollId)
      try { wsRef.current?.close() } catch {}
      wsRef.current = null
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  // heartbeat ping so /api/players sees us as active
  useEffect(() => {
    if (isPreview) return // do not advertise preview as a real player

    const sendHeartbeat = async () => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'ping' })) } catch {}
        return
      }
      // WS not connected: HTTP fallback
      try {
        const label = localStorage.getItem('player_label') || ''
        const name = label || (navigator.platform || 'Player')
        await fetch('/api/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, ua: navigator.userAgent })
        })
      } catch {}
    }

    const id = window.setInterval(sendHeartbeat, 20000)
    // send one immediately on mount
    sendHeartbeat()
    return () => window.clearInterval(id)
  }, [])

  // Try to auto-enter fullscreen on mount (best-effort; may be blocked by browser)
  useEffect(() => {
    // Only attempt fullscreen when allowed (not inside iframes and feature is enabled)
    const canFullscreen =
      typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      (document as any).fullscreenEnabled &&
      window.self === window.top

    if (!canFullscreen) return

    const tryFs = () => {
      const el: any = document.documentElement as any
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen
      if (typeof req === 'function') {
        try {
          // Some browsers return a promise, others don't
          const p = req.call(el)
          if (p && typeof p.catch === 'function') p.catch(() => {})
        } catch {}
      }
    }

    // Request on first user interaction only to satisfy browser policies
    const onInteract = () => {
      tryFs()
      document.removeEventListener('click', onInteract)
    }

    document.addEventListener('click', onInteract, { once: true })
    return () => {
      document.removeEventListener('click', onInteract)
    }
  }, [])

  const activePlaylist = useMemo(() => {
    const now = Date.now()
    // helper: day/time match if provided
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
    return schedules
      .filter(s => now >= s.startAt && now <= s.endAt)
      .filter((s: any) => (Array.isArray(s.days) ? s.days.includes(day) : true))
      .filter((s: any) => inTimeWindow(s.startTime, s.endTime))
      .sort((a, b) => a.order - b.order)
  }, [schedules])

  const displayList = useMemo(() => {
    // If no active schedule, loop all uploaded files by name with enhanced duration handling
    if (activePlaylist.length === 0) {
      return files.map(f => ({ 
        id: f.id, 
        fileId: f.id, 
        // Preserve file-level duration for proper override hierarchy
        ...(typeof (f as any)?.durationSeconds === 'number' && (f as any).durationSeconds > 0 ? { durationSeconds: (f as any).durationSeconds } : {}) 
      }))
    }
    return activePlaylist
  }, [activePlaylist, files])

  // Auto-start functionality when content becomes available
  useEffect(() => {
    if (isPreview) return // Don't auto-start in preview mode
    
    console.log('Player: Auto-start check - enabled:', autoStartEnabled, 'hasStarted:', hasAutoStarted, 'powered:', powered)
    console.log('Player: Display list length:', displayList.length, 'Active index:', activeIndex)
    
    if (!autoStartEnabled || hasAutoStarted || !powered) return
    
    // Check if we have content to play
    if (displayList.length > 0) {
      const currentFile = files.find(f => f.id === (displayList[activeIndex] as any)?.fileId)
      console.log('Player: Current file for auto-start:', currentFile?.name, currentFile?.mime)
      
      if (currentFile) {
        console.log('Player: Auto-starting playback with content:', currentFile.name)
        setHasAutoStarted(true)
        
        // Ensure content starts playing immediately
        if (currentFile.mime.startsWith('video/')) {
          const activeVideo = getActiveVideo()
          if (activeVideo) {
            console.log('Player: Starting video playback')
            setTimeout(() => {
              safePlay(activeVideo)
            }, 100) // Small delay to ensure video element is ready
          }
        } else if (currentFile.mime.startsWith('image/') || currentFile.mime.startsWith('link/')) {
          console.log('Player: Displaying', currentFile.mime.split('/')[0], 'content')
          // Images and links display immediately, no special action needed
        }
      } else {
        console.log('Player: No current file found for auto-start')
      }
    } else {
      console.log('Player: No content available for auto-start')
    }
  }, [displayList.length, powered, autoStartEnabled, hasAutoStarted, activeIndex, files, isPreview])

  // Reset auto-start flag when content changes significantly
  useEffect(() => {
    if (displayList.length === 0) {
      console.log('Player: No content available, resetting auto-start flag')
      setHasAutoStarted(false)
    } else if (!hasAutoStarted && displayList.length > 0) {
      console.log('Player: Content became available, will trigger auto-start')
      // Auto-start will be triggered by the auto-start useEffect
    }
  }, [displayList.length, hasAutoStarted])
  
  // Controlled content monitoring - reduce unnecessary refreshing
  useEffect(() => {
    // Only refresh every 60 seconds to reduce unexpected refreshing
    // This ensures we stay up to date without being disruptive
    const contentRefreshInterval = setInterval(() => {
      // Only refresh if we're not in the middle of playing content
      if (!powered || displayList.length === 0) {
        console.log('Player: Periodic content check (powered off or no content)')
        load()
      } else {
        console.log('Player: Skipping periodic refresh (content is playing)')
      }
    }, 60000) // Reduced from 10s to 60s
    
    return () => clearInterval(contentRefreshInterval)
  }, [powered, displayList.length])

  // Advance helper with bounds guard
  const advance = () => {
    if (!displayList.length) return
    const nextIdx = (activeIndex + 1) % displayList.length
    const nextItem: any = displayList[nextIdx]
    const nextFile = files.find(f => f.id === nextItem?.fileId)

    // Helper: ensure idle tag has next video src preloaded
    const ensureIdlePreloaded = (fileId: string) => {
      const f = files.find(ff => ff.id === fileId)
      if (!f || !f.mime.startsWith('video/')) return
      const idle = getIdleVideo()
      if (!idle) return
      const nextSrc = `/api/files/stream/${f.id}`
      if (idle.src !== location.origin + nextSrc) {
        idle.src = nextSrc
        idle.preload = 'auto'
        idle.muted = true
        try { idle.load() } catch {}
        idle.play?.().catch(() => {})
      }
    }

    // Helper: switch only when idle is really ready to render a frame (avoid black)
    const idleReadyToRender = () => {
      const idle = getIdleVideo()
      return !!idle && idle.readyState >= 3 /* HAVE_FUTURE_DATA */
    }

    if (nextFile?.mime?.startsWith('video/')) {
      ensureIdlePreloaded(nextFile.id)
      const idle = getIdleVideo()
      if (idleReadyToRender()) {
        makeActiveIdleSwitch()
        setActiveIndex(nextIdx)
      } else if (idle) {
        const onCanPlay = () => {
          idle.removeEventListener('canplay', onCanPlay)
          makeActiveIdleSwitch()
          setActiveIndex(nextIdx)
        }
        idle.addEventListener('canplay', onCanPlay, { once: true })
      } else {
        // Fallback if no idle tag (shouldn't happen)
        setActiveIndex(nextIdx)
      }
      return
    }

    // Non-video: switch immediately
    setActiveIndex(nextIdx)
  }

  // New: go previous helper with bounds guard similar to advance
  const goPrev = () => {
    if (!displayList.length) return
    const prevIdx = (activeIndex - 1 + displayList.length) % displayList.length
    const prevItem: any = displayList[prevIdx]
    const prevFile = files.find(f => f.id === prevItem?.fileId)

    // Preload if previous is video
    const ensureIdlePreloaded = (fileId: string) => {
      const f = files.find(ff => ff.id === fileId)
      if (!f || !f.mime.startsWith('video/')) return
      const idle = getIdleVideo()
      if (!idle) return
      const src = `/api/files/stream/${f.id}`
      if (idle.src !== location.origin + src) {
        idle.src = src
        idle.preload = 'auto'
        idle.muted = true
        try { idle.load() } catch {}
        idle.play?.().catch(() => {})
      }
    }

    const idleReadyToRender = () => {
      const idle = getIdleVideo()
      return !!idle && idle.readyState >= 3
    }

    if (prevFile?.mime?.startsWith('video/')) {
      ensureIdlePreloaded(prevFile.id)
      const idle = getIdleVideo()
      if (idleReadyToRender()) {
        makeActiveIdleSwitch()
        setActiveIndex(prevIdx)
      } else if (idle) {
        const onCanPlay = () => {
          idle.removeEventListener('canplay', onCanPlay)
          makeActiveIdleSwitch()
          setActiveIndex(prevIdx)
        }
        idle.addEventListener('canplay', onCanPlay, { once: true })
      } else {
        setActiveIndex(prevIdx)
      }
      return
    }

    setActiveIndex(prevIdx)
  }

  // Clear any pending advance timers
  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current) {
      window.clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }

  // Preload the next video into the idle tag to avoid black transition
  const preloadNext = (nextFileId: string | null) => {
    if (!nextFileId) return
    const f = files.find(ff => ff.id === nextFileId)
    if (!f || !f.mime.startsWith('video/')) return
    const idle = getIdleVideo()
    if (!idle) return
    const nextSrc = `/api/files/stream/${f.id}`
    if (idle.src !== location.origin + nextSrc) {
      idle.src = nextSrc
      idle.preload = 'auto'
      idle.muted = true // always muted for preload
      try { idle.load() } catch {}
      // ensure buffering starts and time-to-first-frame is minimized
      idle.play?.().catch(() => {})
    }
  }

  // When switching items, handle timers based on media type
  useEffect(() => {
    clearAdvanceTimer()
    // Do not run any timers or playback changes when powered off
    if (!powered) {
      try { getActiveVideo()?.pause() } catch {}
      return
    }
    if (!displayList.length) return

    const item = displayList[activeIndex] as any
    const file = files.find(f => f.id === item.fileId)
    if (!file) return

    // Enhanced duration override system - prioritize any specified duration
    const getEffectiveDuration = (item: any, file: any) => {
      // Priority 1: Schedule item duration (highest priority)
      if (typeof item.durationSeconds === 'number' && item.durationSeconds > 0) {
        return item.durationSeconds
      }
      
      // Priority 2: File-specific duration
      if (typeof file.durationSeconds === 'number' && file.durationSeconds > 0) {
        return file.durationSeconds
      }
      
      // Priority 3: Global defaults based on mime type
      if (file.mime.startsWith('image/')) {
        return serverSettings?.defaultImageDuration || 10
      }
      if (file.mime.startsWith('link/')) {
        return serverSettings?.defaultLinkDuration || 30
      }
      
      // Fallback for unknown types
      return 10
    }

    if (file.mime.startsWith('image/') || file.mime.startsWith('link/')) {
      // For images/links: use comprehensive duration override system
      const effectiveDuration = getEffectiveDuration(item, file)
      console.log(`Player: ${file.mime.split('/')[0]} duration - Schedule: ${item.durationSeconds}, File: ${(file as any).durationSeconds}, Global: ${file.mime.startsWith('image/') ? (serverSettings?.defaultImageDuration || 10) : (serverSettings?.defaultLinkDuration || 30)}, Using: ${effectiveDuration}s`)
      
      advanceTimerRef.current = window.setTimeout(advance, Math.max(0.1, effectiveDuration) * 1000)
      // Ensure active video is paused
      try { getActiveVideo()?.pause() } catch {}
      // Preload next if it's a video
      const nextIdx = (activeIndex + 1) % displayList.length
      const nextItem = displayList[nextIdx] as any
      preloadNext(nextItem?.fileId || null)
      return
    }

    if (file.mime.startsWith('video/')) {
      const activeVideo = getActiveVideo()
      if (!activeVideo) return

      // Load current into active tag if not already set
      const curSrc = `/api/files/stream/${file.id}`
      if (activeVideo.src !== location.origin + curSrc) {
        activeVideo.src = curSrc
        activeVideo.preload = 'auto'
      }
      // Apply mute
      // All videos always muted due to browser policies
      const effectiveMutedLocal = true
      activeVideo.muted = effectiveMutedLocal

      // Enhanced video duration override system
      const setBackup = () => {
        clearAdvanceTimer()
        
        // Priority 1: Schedule item duration (highest priority)
        const scheduleOverride = Number((item as any)?.durationSeconds)
        if (Number.isFinite(scheduleOverride) && scheduleOverride > 0) {
          console.log(`Player: Video using schedule duration override: ${scheduleOverride}s`)
          advanceTimerRef.current = window.setTimeout(advance, Math.max(0.1, scheduleOverride) * 1000)
          return
        }
        
        // Priority 2: File-specific duration
        const fileOverride = Number((file as any).durationSeconds)
        if (Number.isFinite(fileOverride) && fileOverride > 0) {
          console.log(`Player: Video using file duration override: ${fileOverride}s`)
          advanceTimerRef.current = window.setTimeout(advance, Math.max(0.1, fileOverride) * 1000)
          return
        }
        
        // Priority 3: Natural video duration (default behavior)
        const naturalDur = isFinite(activeVideo.duration) && activeVideo.duration > 0 ? activeVideo.duration : 30
        console.log(`Player: Video using natural duration: ${naturalDur}s`)
        advanceTimerRef.current = window.setTimeout(advance, (naturalDur + 0.5) * 1000)
      }

      if (isFinite(activeVideo.duration) && activeVideo.duration > 0) {
        setBackup()
      } else {
        const onLoaded = () => { setBackup(); activeVideo.removeEventListener('loadedmetadata', onLoaded) }
        activeVideo.addEventListener('loadedmetadata', onLoaded)
      }

      // Start playback (always muted due to browser policies)
      safePlay(activeVideo)

      // Preload the next item (if video) into idle tag for seamless switch
      const nextIdx = (activeIndex + 1) % displayList.length
      const nextItem = displayList[nextIdx] as any
      preloadNext(nextItem?.fileId || null)
      return
    }

    // Unknown type: fallback after 10s
    advanceTimerRef.current = window.setTimeout(advance, 10000)
  }, [
    activeIndex,
    displayList.length,
    powered,
    // Re-arm timers when current item's identity or duration changes (e.g., after schedules load)
    (displayList as any)[activeIndex]?.fileId,
    (displayList as any)[activeIndex]?.durationSeconds,
  ])

  // Clear timer on unmount
  useEffect(() => () => clearAdvanceTimer(), [])

  // Swap to preloaded idle video when advancing to a video that is already canplay
  useEffect(() => {
    // All videos are always muted due to browser policies
    if (videoARef.current) {
      videoARef.current.muted = true
      videoARef.current.volume = 1
    }
    if (videoBRef.current) {
      videoBRef.current.muted = true
      videoBRef.current.volume = 1
    }
  }, [activeIndex, displayList])

  // Apply brightness to both video tags on change
  useEffect(() => {
    // Only brightness control remains - volume/mute removed due to browser policies
    if (videoARef.current) {
      videoARef.current.volume = 1
      videoARef.current.muted = true
    }
    if (videoBRef.current) {
      videoBRef.current.volume = 1
      videoBRef.current.muted = true
    }
  }, [brightness, displayList, activeIndex, isPreview])

  const currentFile = useMemo(() => {
    if (displayList.length === 0) return null
    const item = displayList[activeIndex]
    return files.find(f => f.id === (item as any).fileId) || null
  }, [displayList, activeIndex, files])

  useEffect(() => {
    // if current file was removed, jump to next available
    if (displayList.length && !currentFile) {
      setActiveIndex(0)
      try { getActiveVideo()?.pause() } catch {}
    }
  }, [currentFile, displayList.length])

  // Compute effective mute for current media - always true due to browser policies
  const effectiveMuted = useMemo(() => {
    // Always muted due to browser autoplay policies
    return true
  }, [displayList, activeIndex])

  // Enhanced state broadcasting to parent (admin Live Preview) for perfect sync
  useEffect(() => {
    if (!isPreview) return
    
    const broadcastState = () => {
      try {
        const payload = {
          type: 'player_state',
          nowPlaying: currentFile ? { 
            id: currentFile.id, 
            name: currentFile.name, 
            mime: currentFile.mime, 
            url: currentFile.url 
          } : null,
          powered,
          orientation,
          brightness,
          muted: effectiveMuted,
          activeIndex,
          totalFiles: files.length,
          totalSchedules: schedules.length,
          displayListLength: displayList.length,
          autoStartEnabled,
          hasAutoStarted,
          isRefreshing,
          timestamp: Date.now()
        }
        console.log('Player: Broadcasting state to admin:', payload)
        window.parent.postMessage(payload, '*')
      } catch (err) {
        console.warn('Player: Failed to broadcast state:', err)
      }
    }
    
    // Broadcast immediately
    broadcastState()
    
    // Reduced broadcasting frequency to prevent interference
    const broadcastInterval = setInterval(broadcastState, 5000) // Reduced from 2s to 5s
    
    return () => clearInterval(broadcastInterval)
  }, [currentFile?.id, powered, orientation, brightness, effectiveMuted, activeVideoTag, activeIndex, files.length, schedules.length, displayList.length, autoStartEnabled, hasAutoStarted, isRefreshing])

  // Enhanced message handling for admin sync requests
  useEffect(() => {
    if (!isPreview) return
    
    const onMsg = (e: MessageEvent) => {
      const data: any = e?.data
      if (!data || typeof data !== 'object') return
      
      console.log('Player: Received message from admin:', data.type)
      
      if (data.type === 'request_state') {
        try {
          const payload = {
            type: 'player_state',
            nowPlaying: currentFile ? { 
              id: currentFile.id, 
              name: currentFile.name, 
              mime: currentFile.mime, 
              url: currentFile.url 
            } : null,
            powered,
            orientation,
            brightness,
            muted: effectiveMuted,
            activeIndex,
            totalFiles: files.length,
            totalSchedules: schedules.length,
            displayListLength: displayList.length,
            autoStartEnabled,
            hasAutoStarted,
            isRefreshing,
            timestamp: Date.now()
          }
          console.log('Player: Responding to state request with:', payload)
          window.parent.postMessage(payload, '*')
        } catch (err) {
          console.error('Player: Failed to respond to state request:', err)
        }
      }
      
      if (data.type === 'hard_refresh') {
        console.log('Player: Received hard refresh request')
        doVisibleRefresh()
      }
      
      if (data.type === 'sync_settings' && data.settings) {
        console.log('Player: Syncing settings from admin:', data.settings)
        try {
          if (typeof data.settings.brightness === 'number') {
            setBrightness(data.settings.brightness)
          }
          if (typeof data.settings.orientation === 'string') {
            setOrientation(data.settings.orientation)
          }
          if (typeof data.settings.autoStart === 'boolean') {
            setAutoStartEnabled(data.settings.autoStart)
          }
        } catch (err) {
          console.error('Player: Failed to sync settings:', err)
        }
      }
    }
    
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [currentFile?.id, powered, orientation, brightness, effectiveMuted, activeIndex, files.length, schedules.length, displayList.length, autoStartEnabled, hasAutoStarted, isRefreshing])

  // Handle seamless switch when next video has been preloaded in idle tag
  const handleActiveEnded = () => {
    advance()
  }

  // Crossfade helper to switch which tag is visible (no black frame)
  const makeActiveIdleSwitch = () => {
    setActiveVideoTag((prev) => (prev === 'A' ? 'B' : 'A'))
  }

  // Auto-resume playback on Power On for video items
  useEffect(() => {
    if (powered && currentFile && currentFile.mime?.startsWith('video/')) {
      safePlay(getActiveVideo())
    }
  }, [powered, currentFile, activeVideoTag, effectiveMuted])

  return (
    <main 
      className="relative w-screen h-[100dvh] bg-black text-white overflow-hidden"
      onClick={() => {
        // Click handler simplified - no audio context needed
      }}
    >
      {/* Fixed watermark in top-right */}
      <div className="pointer-events-none select-none absolute top-3 right-3 z-20 text-xs md:text-sm font-semibold tracking-wide text-white/50 bg-black/20 px-2 py-1 rounded">
        {credits[currentCredit]}
      </div>

      {/* Content */}
      <div
        className={`absolute inset-0 z-0 grid place-items-center bg-black ${orientation === 'portrait' ? 'rotate-90 origin-center' : ''}`}
        style={{ filter: `brightness(${Math.max(0, Math.min(200, brightness))}%)` as any }}
      >
        {!powered && (
          <div className="w-full h-full bg-black" />
        )}
        {powered && !currentFile && (
          <div className="text-center text-white/70 px-4">
            <p className="text-xl">Waiting for content…</p>
            <p className="text-sm">Upload files or add schedule items.</p>
          </div>
        )}
        {powered && currentFile && currentFile.mime.startsWith('image/') && (
          <img
            key={currentFile.id}
            src={currentFile.url}
            alt={currentFile.name}
            loading="eager"
            decoding="async"
            className="w-full h-full object-contain"
          />
        )}
        {powered && currentFile && currentFile.mime.startsWith('video/') && (
          <div className="relative w-full h-full">
            {/* Active tag */}
            <video
              ref={videoARef}
              autoPlay
              muted={true}
              playsInline
              preload="auto"
              controls={false}
              disablePictureInPicture
              controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
              onCanPlay={() => {
                // If this tag is currently visible and source just set, ensure playback
                if (activeVideoTag === 'A') safePlay(videoARef.current)
              }}
              onEnded={activeVideoTag === 'A' ? handleActiveEnded : undefined}
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-150 ${activeVideoTag === 'A' ? 'opacity-100' : 'opacity-0'}`}
            />
            {/* Idle/preload tag */}
            <video
              ref={videoBRef}
              autoPlay
              muted={true}
              playsInline
              preload="auto"
              controls={false}
              disablePictureInPicture
              controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
              onEnded={activeVideoTag === 'B' ? handleActiveEnded : undefined}
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-150 ${activeVideoTag === 'B' ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>
        )}
        {powered && currentFile && currentFile.mime.startsWith('link/') && (
          <div className="relative w-full h-full">
            <EnhancedLinkPlayer
              key={currentFile.id}
              url={currentFile.url}
              name={currentFile.name}
            />
          </div>
        )}
      </div>

      {/* Visible refresh overlay */}
      {isRefreshing && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/60">
          <div className="rounded-md bg-white/10 px-4 py-2 text-sm">Refreshing…</div>
        </div>
      )}
    </main>
  )
}