import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import { supabase } from './supabase'

function getYouTubeId(link) {
  try {
    const url = new URL(link)
    const host = url.hostname.replace(/^www\./, '')

    if (host === 'youtu.be') return url.pathname.slice(1)

    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch') return url.searchParams.get('v')
      const match = url.pathname.match(/^\/(embed|shorts|live)\/([^/?]+)/)
      return match ? match[2] : null
    }

    return null
  } catch {
    return null
  }
}

function loadYouTubeAPI() {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }

    const previousCallback = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YouTube API gagal dimuat.'))
    }

    if (!document.getElementById('youtube-iframe-api')) {
      const script = document.createElement('script')
      script.id = 'youtube-iframe-api'
      script.src = 'https://www.youtube.com/iframe_api'
      script.onerror = () => reject(new Error('Gagal memuat YouTube API.'))
      document.head.appendChild(script)
    }
  })
}

function App() {
  const [showRoom, setShowRoom] = useState(false)
  const [roomCode, setRoomCode] = useState('')
  const [roomName, setRoomName] = useState('')
  const [roomMode, setRoomMode] = useState('create')
  const [isInRoom, setIsInRoom] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [hostToken, setHostToken] = useState('')
  const [roomData, setRoomData] = useState(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoInput, setVideoInput] = useState('')
  const [videoError, setVideoError] = useState('')
  const [playbackPlaying, setPlaybackPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [guestPlaybackReady, setGuestPlaybackReady] = useState(false)
  const [youtubeReady, setYoutubeReady] = useState(false)

  const videoRef = useRef(null)
  const youtubeRef = useRef(null)
  const youtubeContainerRef = useRef(null)
  const screenRef = useRef(null)
  const chatCardRef = useRef(null)
  const lastPublishRef = useRef(0)
  const seenChatIdsRef = useRef(new Set())
  const chatInitializedRef = useRef(false)
  const restoreAttemptedRef = useRef(false)

  const youtubeId = getYouTubeId(videoUrl)
  // Menyimpan ruangan terakhir secara otomatis.
useEffect(() => {
  if (!isInRoom || !roomData?.room_code) return

  const session = {
    room_code: roomData.room_code,
    isHost
  }

  localStorage.setItem(
    'awan_active_room',
    JSON.stringify(session)
  )
}, [isInRoom, roomData?.room_code, isHost])

// Memulihkan ruangan terakhir ketika website dibuka.
useEffect(() => {
  if (restoreAttemptedRef.current) return

  restoreAttemptedRef.current = true

  const saved = localStorage.getItem('awan_active_room')

  if (!saved) return

  const restoreRoom = async () => {
    try {
      const session = JSON.parse(saved)
      const code = session.room_code

      if (!code) throw new Error('Kode ruangan tidak tersedia.')

      const { data, error } = await supabase.rpc('get_room', {
        p_room_code: code
      })

      if (error || !data?.id) {
        throw new Error('Ruangan sudah tidak tersedia.')
      }

      const savedToken = session.isHost
        ? localStorage.getItem(`awan_host_${code}`) || ''
        : ''

      setHostToken(savedToken)
      setIsHost(Boolean(savedToken))
      setRoomData(data)
      setRoomCode(data.room_code)
      setVideoUrl(data.video_url || '')
      setVideoInput(data.video_url || '')
      setPlaybackPlaying(Boolean(data.is_playing))

      setChatMessages([])
      setUnreadChatCount(0)
      setGuestPlaybackReady(false)
      setYoutubeReady(false)

      seenChatIdsRef.current = new Set()
      chatInitializedRef.current = false

      setIsInRoom(true)
      setShowRoom(false)

    } catch (err) {
      console.log('Pemulihan ruangan:', err.message)
      localStorage.removeItem('awan_active_room')
    }
  }

  restoreRoom()
}, [])

  const publishPlayback = useCallback(async (url, playing, position) => {
    if (!isHost || !hostToken || !roomData?.room_code) return

    const { data, error } = await supabase.rpc('update_playback', {
      p_room_code: roomData.room_code,
      p_host_token: hostToken,
      p_video_url: url,
      p_is_playing: playing,
      p_position: Math.max(0, position || 0)
    })

    if (error) {
      console.error('Gagal sinkronisasi:', error.message)
      return
    }

    if (!data) console.error('Token Host tidak valid.')
  }, [isHost, hostToken, roomData?.room_code])

  const latestRef = useRef({})
  latestRef.current = { isHost, videoUrl, publishPlayback }

  const handleCreateRoom = async () => {
    if (!roomName.trim()) {
      setError('Masukkan nama ruang terlebih dahulu.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { data, error } = await supabase.rpc('create_room', {
        p_room_name: roomName.trim()
      })

      if (error) throw error
      if (!data?.room_code || !data?.host_token) {
        throw new Error('Data ruang atau token Host tidak lengkap.')
      }

      const token = data.host_token
      const code = data.room_code

      localStorage.setItem(`awan_host_${code}`, token)

      setHostToken(token)
      setIsHost(true)
      setRoomCode(code)
      setRoomData({
        ...data,
        room_name: roomName.trim(),
        room_code: code,
        video_url: '',
        is_playing: false,
        playback_position: 0
      })

      setVideoUrl('')
      setVideoInput('')
      setPlaybackPlaying(false)
      setChatMessages([])
      setUnreadChatCount(0)
      setGuestPlaybackReady(false)
      setYoutubeReady(false)
      seenChatIdsRef.current = new Set()
      chatInitializedRef.current = false
      setIsInRoom(true)
      setShowRoom(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleJoinRoom = async () => {
    if (!roomCode.trim()) {
      setError('Masukkan kode undangan terlebih dahulu.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const code = roomCode.trim().toUpperCase()
      const { data, error } = await supabase.rpc('get_room', {
        p_room_code: code
      })

      if (error) throw error
      if (!data?.id) throw new Error('Kode ruang tidak ditemukan.')

      const savedToken = localStorage.getItem(`awan_host_${code}`) || ''

      setHostToken(savedToken)
      setIsHost(Boolean(savedToken))
      setGuestPlaybackReady(false)
      setYoutubeReady(false)
      setRoomData(data)
      setRoomCode(data.room_code)
      setVideoUrl(data.video_url || '')
      setVideoInput(data.video_url || '')
      setPlaybackPlaying(Boolean(data.is_playing))
      setChatMessages([])
      setUnreadChatCount(0)
      seenChatIdsRef.current = new Set()
      chatInitializedRef.current = false
      setIsInRoom(true)
      setShowRoom(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLoadVideo = async () => {
    if (!isHost) return

    const link = videoInput.trim()

    if (!link) {
      setVideoError('Masukkan tautan video terlebih dahulu.')
      return
    }

    const id = getYouTubeId(link)

    if (id) {
      setYoutubeReady(false)
      setGuestPlaybackReady(false)
      setVideoUrl(link)
      setPlaybackPlaying(false)
      setVideoError('')
      await publishPlayback(link, false, 0)
      return
    }

    try {
      const url = new URL(link)

      if (!['https:', 'http:'].includes(url.protocol)) throw new Error()

      if (!url.pathname.toLowerCase().endsWith('.mp4')) {
        setVideoError('Gunakan tautan YouTube atau file MP4 langsung.')
        return
      }

      setVideoUrl(link)
      setPlaybackPlaying(false)
      setVideoError('')
      await publishPlayback(link, false, 0)
    } catch {
      setVideoError('Tautan video tidak valid.')
    }
  }

  const leaveRoom = () => {
    localStorage.removeItem('awan_active_room')
    youtubeRef.current?.destroy?.()
    youtubeRef.current = null

    setIsInRoom(false)
    setIsHost(false)
    setHostToken('')
    setRoomData(null)
    setVideoUrl('')
    setVideoInput('')
    setRoomCode('')
    setPlaybackPlaying(false)
    setChatMessages([])
    setChatInput('')
    setUnreadChatCount(0)
    setGuestPlaybackReady(false)
    setYoutubeReady(false)
    seenChatIdsRef.current = new Set()
    chatInitializedRef.current = false
  }

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomData.room_code)
      alert('Kode undangan berhasil disalin!')
    } catch {
      alert('Gagal menyalin kode.')
    }
  }

  const startGuestPlayback = () => {
    if (isHost) return

    if (youtubeId) {
      const player = youtubeRef.current

      if (!youtubeReady || !player?.playVideo) {
        alert('Video masih disiapkan. Tunggu sebentar lalu coba lagi.')
        return
      }

      setGuestPlaybackReady(true)

      try {
        player.playVideo()
      } catch (err) {
        console.error('Guest gagal memulai YouTube:', err)
      }

      return
    }

    const mp4 = videoRef.current

    if (mp4?.play) {
      mp4.play()
        .then(() => setGuestPlaybackReady(true))
        .catch((err) => {
          console.error('Guest gagal memulai MP4:', err)
          alert('Browser belum mengizinkan pemutaran video.')
        })
    }
  }

  const handleFullscreen = async () => {
    const screen = screenRef.current
    if (!screen) return

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (screen.requestFullscreen) {
        await screen.requestFullscreen()
      }
    } catch (err) {
      console.error('Full Screen tidak tersedia:', err)
      alert('Full Screen tidak didukung oleh browser ini. Coba buka melalui situs HTTPS AWAN CINEMA.')
    }
  }

  useEffect(() => {
    const updateFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
      if (!document.fullscreenElement) setUnreadChatCount(0)
    }

    document.addEventListener('fullscreenchange', updateFullscreen)
    return () => document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])

  const openChatFromFullscreen = async () => {
    setUnreadChatCount(0)

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch (err) {
        console.error('Gagal keluar Full Screen:', err)
      }
    }

    setTimeout(() => {
      chatCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }, 150)
  }

  // Membuat YouTube Player.
  useEffect(() => {
    if (!youtubeId || !isInRoom) return

    let cancelled = false
    let createdPlayer = null

    setYoutubeReady(false)

    loadYouTubeAPI()
      .then((YT) => {
        if (cancelled || !youtubeContainerRef.current) return

        const playerElement = document.createElement('div')
        youtubeContainerRef.current.replaceChildren(playerElement)

        createdPlayer = new YT.Player(playerElement, {
          videoId: youtubeId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: latestRef.current.isHost ? 1 : 0,
            disablekb: latestRef.current.isHost ? 0 : 1,
            playsinline: 1,
            rel: 0,
            enablejsapi: 1,
            origin: window.location.origin,
            fs: 0
          },
          events: {
            onReady: () => {
              console.log('AWAN CINEMA YouTube siap.')
              if (!cancelled) setYoutubeReady(true)
            },

            onError: (event) => {
              console.error('YouTube Player error:', event.data)
              if (!cancelled) setYoutubeReady(false)
            },

            onStateChange: (event) => {
              const current = latestRef.current
              if (!current.isHost) return

              const state = event.data
              const playing = state === YT.PlayerState.PLAYING

              if (
                state === YT.PlayerState.PLAYING ||
                state === YT.PlayerState.PAUSED ||
                state === YT.PlayerState.ENDED
              ) {
                setPlaybackPlaying(playing)

                current.publishPlayback(
                  current.videoUrl,
                  playing,
                  event.target.getCurrentTime()
                )
              }
            }
          }
        })

        youtubeRef.current = createdPlayer
      })
      .catch((err) => console.error('YouTube Player:', err))

    return () => {
      cancelled = true

      if (youtubeRef.current === createdPlayer) {
        youtubeRef.current = null
      }

      createdPlayer?.destroy?.()
    }
  }, [youtubeId, isInRoom])

  // Sinkronisasi posisi Host ke database.
  useEffect(() => {
    if (!isHost || !youtubeId || !playbackPlaying) return

    const timer = setInterval(() => {
      const player = youtubeRef.current

      if (player?.getCurrentTime && player.getPlayerState?.() === 1) {
        publishPlayback(videoUrl, true, player.getCurrentTime())
      }
    }, 3000)

    return () => clearInterval(timer)
  }, [isHost, youtubeId, playbackPlaying, videoUrl, publishPlayback])

  // Sinkronisasi Guest.
  useEffect(() => {
    if (!isInRoom || isHost || !roomData?.room_code) return

    let active = true
    let syncing = false
    let lastCommand = ''
    let lastSeekTime = 0
    const code = roomData.room_code

    const syncRoom = async () => {
      if (syncing) return
      syncing = true

      try {
        const { data, error } = await supabase.rpc('get_room', {
          p_room_code: code
        })

        if (!active || error || !data?.id) return

        if ((data.video_url || '') !== videoUrl) {
          setRoomData(data)
          setVideoUrl(data.video_url || '')
          setVideoInput(data.video_url || '')
          setPlaybackPlaying(Boolean(data.is_playing))
          setYoutubeReady(false)
          setGuestPlaybackReady(false)
          lastCommand = ''
          return
        }

        const position = Number(data.playback_position || 0)
        const playing = Boolean(data.is_playing)

        setPlaybackPlaying((previous) =>
          previous === playing ? previous : playing
        )

        const player = youtubeRef.current

        if (youtubeId && player?.getCurrentTime && player.getPlayerState) {
          const state = player.getPlayerState()

          if (state === 3) return

          const current = player.getCurrentTime()
          const now = Date.now()

          if (
            Math.abs(current - position) > 5 &&
            now - lastSeekTime > 5000
          ) {
            player.seekTo(position, true)
            lastSeekTime = now
          }

          if (
            playing &&
            guestPlaybackReady &&
            youtubeReady &&
            state !== 1 &&
            lastCommand !== 'play'
          ) {
            lastCommand = 'play'
            player.playVideo()
          }

          if (!playing && state === 1 && lastCommand !== 'pause') {
            lastCommand = 'pause'
            player.pauseVideo()
          }

          if (playing && state === 1) lastCommand = 'playing'
          if (!playing && state !== 1) lastCommand = 'paused'
        }

        if (!youtubeId && videoRef.current) {
          const mp4 = videoRef.current

          if (Math.abs(mp4.currentTime - position) > 5) {
            mp4.currentTime = position
          }

          if (playing && guestPlaybackReady && mp4.paused) {
            mp4.play().catch(() => {})
          }

          if (!playing && !mp4.paused) {
            mp4.pause()
          }
        }
      } finally {
        syncing = false
      }
    }

    syncRoom()

    const timer = setInterval(syncRoom, 2000)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [
    isInRoom,
    isHost,
    roomData?.room_code,
    youtubeId,
    videoUrl,
    guestPlaybackReady,
    youtubeReady
  ])

  // Mengambil pesan chat.
  const loadChatMessages = useCallback(async () => {
    if (!roomData?.room_code) return

    const { data, error } = await supabase.rpc('get_messages', {
      p_room_code: roomData.room_code
    })

    if (error) {
      console.error('Gagal mengambil chat:', error.message)
      setChatError('Chat belum dapat dimuat.')
      return
    }

    const messages = Array.isArray(data) ? data : []

    if (!chatInitializedRef.current) {
      seenChatIdsRef.current = new Set(messages.map((item) => item.id))
      chatInitializedRef.current = true
    } else {
      const incoming = messages.filter((item) =>
        !seenChatIdsRef.current.has(item.id) &&
        item.sender_name !== (isHost ? 'Host' : 'Guest')
      )

      if (incoming.length && document.fullscreenElement) {
        setUnreadChatCount((count) => count + incoming.length)
      }

      messages.forEach((item) => seenChatIdsRef.current.add(item.id))
    }

    setChatMessages(messages)
  }, [roomData?.room_code, isHost])

  useEffect(() => {
    if (!isInRoom || !roomData?.room_code) return

    loadChatMessages()
    const timer = setInterval(loadChatMessages, 2000)

    return () => clearInterval(timer)
  }, [isInRoom, roomData?.room_code, loadChatMessages])

  const sendChatMessage = async (event) => {
    event.preventDefault()

    const message = chatInput.trim()
    if (!message || !roomData?.room_code || chatSending) return

    setChatSending(true)
    setChatError('')

    try {
      const { data, error } = await supabase.rpc('send_message', {
        p_room_code: roomData.room_code,
        p_sender_name: isHost ? 'Host' : 'Guest',
        p_message: message
      })

      if (error) throw error
      if (!data) throw new Error('Pesan tidak berhasil dikirim.')

      setChatInput('')
      await loadChatMessages()
    } catch (err) {
      setChatError(err.message || 'Pesan gagal dikirim.')
    } finally {
      setChatSending(false)
    }
  }

  const handleMP4Play = () => {
    if (!isHost) return

    setPlaybackPlaying(true)
    publishPlayback(
      videoUrl,
      true,
      videoRef.current?.currentTime || 0
    )
  }

  const handleMP4Pause = () => {
    if (!isHost) return

    setPlaybackPlaying(false)
    publishPlayback(
      videoUrl,
      false,
      videoRef.current?.currentTime || 0
    )
  }

  const handleMP4Time = () => {
    if (!isHost) return

    const now = Date.now()
    if (now - lastPublishRef.current < 3000) return

    lastPublishRef.current = now

    publishPlayback(
      videoUrl,
      !videoRef.current.paused,
      videoRef.current.currentTime
    )
  }

  const openRoom = (mode) => {
    setRoomMode(mode)
    setRoomName('')
    setRoomCode('')
    setError('')
    setShowRoom(true)
  }

  if (isInRoom && roomData) {
    return (
      <div className="app">
        <header className="navbar">
          <div className="brand">
            <span className="brand-icon">A</span>
            <span>AWAN <b>CINEMA</b></span>
          </div>

          <button className="leave-btn" onClick={leaveRoom}>
            Keluar Ruang
          </button>
        </header>

        <main className="room-page">
          <div className="room-heading">
            <div>
              <div className="eyebrow">
                <span /> YOUR PRIVATE CINEMA
              </div>
              <h1>{roomData.room_name}</h1>
              <p>Nikmati film bersama orang tersayang.</p>
            </div>

            <div className="invite-card">
              <span>KODE UNDANGAN</span>
              <strong>{roomData.room_code}</strong>
              <button onClick={copyRoomCode}>Salin Kode</button>
            </div>
          </div>

          <div className="cinema-layout">
            <section className="player-section">
              <div className="video-screen" ref={screenRef}>
                {youtubeId ? (
                  <div
                    ref={youtubeContainerRef}
                    className={`movie-player ${isHost ? 'host-player' : 'guest-player'}`}
                  />
                ) : videoUrl ? (
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls={isHost}
                    playsInline
                    className="movie-player"
                    onPlay={handleMP4Play}
                    onPause={handleMP4Pause}
                    onTimeUpdate={handleMP4Time}
                  />
                ) : (
                  <div className="empty-screen">
                    <div className="big-play">▶</div>
                    <h2>Layar Bioskop Pribadi</h2>
                    <p>Menunggu Host memasukkan tautan video.</p>
                  </div>
                )}

                {!isHost && videoUrl && !guestPlaybackReady && (
                  <button
                    className="primary-btn guest-start-btn"
                    onClick={startGuestPlayback}
                    type="button"
                    disabled={Boolean(youtubeId) && !youtubeReady}
                  >
                    {youtubeId && !youtubeReady
                      ? 'MENYIAPKAN VIDEO…'
                      : '▶ MULAI MENONTON'}
                  </button>
                )}

                {isFullscreen && unreadChatCount > 0 && (
                  <button
                    className="fullscreen-chat-badge"
                    onClick={openChatFromFullscreen}
                    type="button"
                  >
                    💬 {unreadChatCount} pesan baru · Lihat chat
                  </button>
                )}

                <button
                  className="fullscreen-btn"
                  onClick={handleFullscreen}
                  type="button"
                >
                  ⛶ Full Screen
                </button>
              </div>

              <div className="video-input-card">
                <label>SUMBER VIDEO</label>

                {isHost ? (
                  <>
                    <input
                      type="url"
                      value={videoInput}
                      onChange={(e) => setVideoInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleLoadVideo()
                      }}
                      placeholder="Tempel link YouTube atau MP4"
                    />

                    {videoError && (
                      <p className="error-message">{videoError}</p>
                    )}

                    <button
                      className="primary-btn full-btn"
                      onClick={handleLoadVideo}
                    >
                      Putar Video
                    </button>

                    {videoUrl && (
                      <button
                        className="clear-video-btn"
                        onClick={async () => {
                          setVideoUrl('')
                          setVideoInput('')
                          setPlaybackPlaying(false)
                          setYoutubeReady(false)
                          setGuestPlaybackReady(false)
                          await publishPlayback('', false, 0)
                        }}
                      >
                        Hapus Video
                      </button>
                    )}
                  </>
                ) : (
                  <p>
                    <b>Mode Penonton.</b> Host sedang mengendalikan pemutaran
                    film. Tunggu Host memilih video.
                  </p>
                )}

                <p>Mendukung YouTube dan file MP4 langsung.</p>
              </div>
            </section>

            <aside className="room-sidebar">
              <div className="chat-card" ref={chatCardRef}>
                <div className="chat-heading">
                  <strong>Live Chat</strong>
                  <span>Ruang Nobar</span>
                </div>

                <div className="chat-messages">
                  {chatMessages.length === 0 ? (
                    <p className="chat-empty">
                      Belum ada pesan. Mulai obrolan!
                    </p>
                  ) : (
                    chatMessages.map((item) => (
                      <div
                        className={`chat-message ${
                          item.sender_name === (isHost ? 'Host' : 'Guest')
                            ? 'my-message'
                            : ''
                        }`}
                        key={item.id}
                      >
                        <strong>{item.sender_name || 'Penonton'}</strong>
                        <p>{item.message}</p>
                        <small>
                          {item.created_at
                            ? new Date(item.created_at).toLocaleTimeString(
                                'id-ID',
                                {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                }
                              )
                            : ''}
                        </small>
                      </div>
                    ))
                  )}
                </div>

                {chatError && (
                  <p className="error-message">{chatError}</p>
                )}

                <form className="chat-form" onSubmit={sendChatMessage}>
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Tulis pesan..."
                    maxLength={1000}
                  />

                  <button
                    type="submit"
                    disabled={chatSending || !chatInput.trim()}
                  >
                    {chatSending ? '...' : 'Kirim'}
                  </button>
                </form>
              </div>

              <div className="sidebar-card">
                <span className="sidebar-label">STATUS RUANG</span>
                <div className="online-status">
                  <span /> Ruang aktif
                </div>

                <hr />

                <span className="sidebar-label">PERAN KAMU</span>
                <strong>{isHost ? 'HOST / PEMILIK' : 'GUEST / PENONTON'}</strong>

                <span className="sidebar-label">NAMA RUANG</span>
                <strong>{roomData.room_name}</strong>

                <span className="sidebar-label">KODE UNDANGAN</span>
                <strong className="code-text">{roomData.room_code}</strong>

                <button
                  className="primary-btn full-btn"
                  onClick={copyRoomCode}
                >
                  Salin Kode Undangan
                </button>
              </div>

              <div className="sidebar-note">
                <span>✦</span>
                <p>
                  {isHost
                    ? 'Kamu adalah Host. Kendalikan film dan pasanganmu akan mengikuti.'
                    : 'Kamu adalah Guest. Pemutaran film dikendalikan oleh Host.'}
                </p>
              </div>
            </aside>
          </div>
        </main>

        <footer>
          <span>© 2026 AWAN CINEMA</span>
          <span>Made for two. Made for memories.</span>
        </footer>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="navbar">
        <div className="brand">
          <span className="brand-icon">A</span>
          <span>AWAN <b>CINEMA</b></span>
        </div>
        <span className="private-label">PRIVATE CINEMA</span>
      </header>

      <main className="hero">
        <div className="hero-content">
          <div className="eyebrow">
            <span /> YOUR PRIVATE MOVIE ROOM
          </div>

          <h1>
            Every movie is better
            <br />
            <span>together.</span>
          </h1>

          <p>
            Nikmati film favorit bersama orang tersayang.
            Satu layar, dua tempat, satu pengalaman.
          </p>

          <div className="actions">
            <button
              className="primary-btn"
              onClick={() => openRoom('create')}
            >
              + Buat Ruang Nobar
            </button>

            <button
              className="secondary-btn"
              onClick={() => openRoom('join')}
            >
              Gabung Ruang
            </button>
          </div>

          <div className="features">
            <div>◉ Sinkronisasi video</div>
            <div>♡ Private room</div>
            <div>✦ Live chat</div>
          </div>
        </div>

        <div className="cinema-art">
          <div className="screen">
            <div className="screen-glow">▶</div>
            <span>YOUR PRIVATE CINEMA</span>
          </div>
          <div className="seat">▰</div>
        </div>
      </main>

      <footer>
        <span>© 2026 AWAN CINEMA</span>
        <span>Made for two. Made for memories.</span>
      </footer>

      {showRoom && (
        <div className="modal-overlay">
          <div className="modal">
            <button
              className="close-btn"
              onClick={() => setShowRoom(false)}
            >
              ×
            </button>

            <h2>
              {roomMode === 'create'
                ? 'Buat Ruang Nobar'
                : 'Gabung Ruang Nobar'}
            </h2>

            <p>
              {roomMode === 'create'
                ? 'Buat bioskop pribadimu.'
                : 'Masukkan kode undangan dari temanmu.'}
            </p>

            {roomMode === 'create' ? (
              <>
                <label>Nama ruang</label>
                <input
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Contoh: Movie Night"
                />
              </>
            ) : (
              <>
                <label>Kode undangan</label>
                <input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="Masukkan kode ruang"
                />
              </>
            )}

            {error && <p className="error-message">{error}</p>}

            <button
              className="primary-btn full-btn"
              onClick={
                roomMode === 'create'
                  ? handleCreateRoom
                  : handleJoinRoom
              }
              disabled={loading}
            >
              {loading
                ? 'Memproses...'
                : roomMode === 'create'
                  ? 'Buat Ruang'
                  : 'Gabung Sekarang'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App