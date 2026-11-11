
import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import { supabase } from './supabase'

// Deteksi YouTube
function getYouTubeId(link) {
  try {
    const url = new URL(link)
    const host = url.hostname.replace(/^www\./, '')

    if (host === 'youtu.be') return url.pathname.slice(1)

    if (
      ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)
    ) {
      if (url.pathname === '/watch') return url.searchParams.get('v')

      const match = url.pathname.match(
        /^\/(embed|shorts|live)\/([^/?]+)/
      )

      return match ? match[2] : null
    }

    return null
  } catch {
    return null
  }
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

  const videoRef = useRef(null)
  const youtubeRef = useRef(null)
  const youtubeContainerRef = useRef(null)
  const lastPublishRef = useRef(0)

  const youtubeId = getYouTubeId(videoUrl)

  // Kirim perubahan pemutaran ke database
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

    if (!data) {
      console.error('Token Host tidak valid.')
    }
  }, [isHost, hostToken, roomData])

  // Buat ruang
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
      setIsInRoom(true)
      setShowRoom(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Gabung ruang
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
      if (!data?.id) {
        throw new Error('Kode ruang tidak ditemukan.')
      }

      const savedToken = localStorage.getItem(`awan_host_${code}`) || ''

      setHostToken(savedToken)
      setIsHost(Boolean(savedToken))
      setRoomData(data)
      setRoomCode(data.room_code)

      setVideoUrl(data.video_url || '')
      setVideoInput(data.video_url || '')
      setPlaybackPlaying(Boolean(data.is_playing))

      setIsInRoom(true)
      setShowRoom(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Ganti video
  const handleLoadVideo = async () => {
    if (!isHost) return

    const link = videoInput.trim()

    if (!link) {
      setVideoError('Masukkan tautan video terlebih dahulu.')
      return
    }

    const id = getYouTubeId(link)

    if (id) {
      setVideoUrl(link)
      setPlaybackPlaying(false)
      setVideoError('')

      await publishPlayback(link, false, 0)
      return
    }

    try {
      const url = new URL(link)

      if (!['https:', 'http:'].includes(url.protocol)) {
        throw new Error()
      }

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

  // Keluar ruang
  const leaveRoom = () => {
    setIsInRoom(false)
    setIsHost(false)
    setHostToken('')
    setRoomData(null)
    setVideoUrl('')
    setVideoInput('')
    setRoomCode('')
    setPlaybackPlaying(false)
  }

  // Salin kode
  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomData.room_code)
      alert('Kode undangan berhasil disalin!')
    } catch {
      alert('Gagal menyalin kode.')
    }
  }

  // Load YouTube IFrame API
  useEffect(() => {
    if (!youtubeId || !isInRoom) return

    let cancelled = false

    const loadYouTube = () => {
      return new Promise((resolve) => {
        if (window.YT?.Player) {
          resolve(window.YT)
          return
        }

        const previous = window.onYouTubeIframeAPIReady

        window.onYouTubeIframeAPIReady = () => {
          previous?.()
          resolve(window.YT)
        }

        if (!document.getElementById('youtube-iframe-api')) {
          const script = document.createElement('script')
          script.id = 'youtube-iframe-api'
          script.src = 'https://www.youtube.com/iframe_api'
          document.head.appendChild(script)
        }
      })
    }

    loadYouTube().then((YT) => {
      if (cancelled || !youtubeContainerRef.current) return

      youtubeRef.current?.destroy?.()

      youtubeRef.current = new YT.Player(youtubeContainerRef.current, {
        videoId: youtubeId,
        width: '100%',
        height: '100%',

        playerVars: {
          autoplay: 0,
          controls: isHost ? 1 : 0,
          disablekb: isHost ? 0 : 1,
          playsinline: 1,
          rel: 0
        },

        events: {
          onReady: () => {
            console.log('AWAN CINEMA YouTube siap.')
          },

          onStateChange: (event) => {
            if (!isHost) return

            const state = event.data
            const playing = state === YT.PlayerState.PLAYING

            if (
              state === YT.PlayerState.PLAYING ||
              state === YT.PlayerState.PAUSED ||
              state === YT.PlayerState.ENDED
            ) {
              setPlaybackPlaying(playing)

              publishPlayback(
                videoUrl,
                playing,
                event.target.getCurrentTime()
              )
            }
          }
        }
      })
    })

    return () => {
      cancelled = true
      youtubeRef.current?.destroy?.()
      youtubeRef.current = null
    }
  }, [youtubeId, isHost, isInRoom, publishPlayback])

  // Sinkronisasi posisi YouTube dari Host
  useEffect(() => {
    if (!isHost || !youtubeId || !playbackPlaying) return

    const timer = setInterval(() => {
      const player = youtubeRef.current

      if (player?.getCurrentTime) {
        publishPlayback(
          videoUrl,
          true,
          player.getCurrentTime()
        )
      }
    }, 3000)

    return () => clearInterval(timer)
  }, [isHost, youtubeId, playbackPlaying, videoUrl, publishPlayback])

  // Sinkronisasi Guest melalui polling database
  useEffect(() => {
    if (!isInRoom || isHost || !roomData?.room_code) return

    const syncRoom = async () => {
      const { data, error } = await supabase.rpc('get_room', {
        p_room_code: roomData.room_code
      })

      if (error || !data?.id) return

      setRoomData(data)

      if ((data.video_url || '') !== videoUrl) {
        setVideoUrl(data.video_url || '')
        setVideoInput(data.video_url || '')
        setPlaybackPlaying(Boolean(data.is_playing))
        return
      }

      const position = Number(data.playback_position || 0)
      const playing = Boolean(data.is_playing)

      setPlaybackPlaying(playing)

      if (youtubeId && youtubeRef.current?.getCurrentTime) {
        const player = youtubeRef.current
        const current = player.getCurrentTime()

        if (Math.abs(current - position) > 2.5) {
          player.seekTo(position, true)
        }

        const state = player.getPlayerState()

        if (playing && state !== 1) player.playVideo()
        if (!playing && state === 1) player.pauseVideo()
      }

      if (!youtubeId && videoRef.current) {
        const player = videoRef.current

        if (Math.abs(player.currentTime - position) > 2.5) {
          player.currentTime = position
        }

        if (playing && player.paused) {
          player.play().catch(() => {})
        }

        if (!playing && !player.paused) {
          player.pause()
        }
      }
    }

    syncRoom()

    const timer = setInterval(syncRoom, 1000)

    return () => clearInterval(timer)
  }, [isInRoom, isHost, roomData?.room_code, videoUrl, youtubeId])

  // Perubahan video MP4 oleh Host
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

  // HALAMAN RUANG NOBAR
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
                <span></span> YOUR PRIVATE CINEMA
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
              <div className="video-screen">
                {youtubeId ? (
                  <div
                    ref={youtubeContainerRef}
                    className="movie-player"
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
                    <p>
                      Menunggu Host memasukkan tautan video.
                    </p>
                  </div>
                )}
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
                          await publishPlayback('', false, 0)
                        }}
                      >
                        Hapus Video
                      </button>
                    )}
                  </>
                ) : (
                  <p>
                    <b>Mode Penonton.</b> Host sedang mengendalikan
                    pemutaran film. Tunggu Host memilih video.
                  </p>
                )}

                <p>
                  Mendukung YouTube dan file MP4 langsung.
                </p>
              </div>
            </section>

            <aside className="room-sidebar">
              <div className="sidebar-card">
                <span className="sidebar-label">STATUS RUANG</span>

                <div className="online-status">
                  <span></span> Ruang aktif
                </div>

                <hr />

                <span className="sidebar-label">PERAN KAMU</span>
                <strong>{isHost ? 'HOST / PEMILIK' : 'GUEST / PENONTON'}</strong>

                <span className="sidebar-label">NAMA RUANG</span>
                <strong>{roomData.room_name}</strong>

                <span className="sidebar-label">KODE UNDANGAN</span>
                <strong className="code-text">
                  {roomData.room_code}
                </strong>

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

  // HALAMAN UTAMA
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
            <span></span> YOUR PRIVATE MOVIE ROOM
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
