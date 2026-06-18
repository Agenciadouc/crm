import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Trash2, Send, Loader } from 'lucide-react'

type Props = {
  onSend: (blob: Blob, mime: string) => Promise<void> | void
  disabled?: boolean
}

const PREFERRED_MIME = 'audio/webm;codecs=opus'

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function AudioRecorder({ onSend, disabled }: Props) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'preview' | 'sending'>('idle')
  const [duration, setDuration] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mimeRef = useRef<string>(PREFERRED_MIME)

  // Cleanup: para o mic se desmontar ou trocar de lead
  useEffect(() => {
    return () => {
      stopStream()
      if (timerRef.current) clearInterval(timerRef.current)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  async function startRecording() {
    setError(null)
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setError('Seu navegador nao suporta gravacao de audio. Use Chrome ou Edge atualizado.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const supported = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? PREFERRED_MIME : ''
      const recorder = supported ? new MediaRecorder(stream, { mimeType: supported }) : new MediaRecorder(stream)
      mimeRef.current = supported || recorder.mimeType || 'audio/webm'
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current })
        blobRef.current = blob
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        setPhase('preview')
        stopStream()
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setDuration(0)
      setPhase('recording')
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError'
        ? 'Permissao de microfone negada. Libera no cadeado da barra de URL e tenta de novo.'
        : 'Erro ao acessar microfone: ' + (e?.message || 'desconhecido'))
      stopStream()
      setPhase('idle')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  function discardPreview() {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    blobRef.current = null
    setDuration(0)
    setPhase('idle')
  }

  async function handleSend() {
    if (!blobRef.current) return
    setPhase('sending')
    try {
      await onSend(blobRef.current, mimeRef.current)
      discardPreview()
    } catch (e: any) {
      setError('Erro ao enviar: ' + (e?.message || 'desconhecido'))
      setPhase('preview')
    }
  }

  // === RENDER ===

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#ef4444', maxWidth: 280 }}>{error}</span>
        <button className="btn btn-secondary btn-icon" onClick={() => { setError(null); setPhase('idle') }} title="Fechar aviso">×</button>
      </div>
    )
  }

  if (phase === 'idle') {
    return (
      <button
        className="btn btn-secondary btn-icon"
        onClick={startRecording}
        disabled={disabled}
        title="Gravar audio"
      >
        <Mic size={16} />
      </button>
    )
  }

  if (phase === 'recording') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', animation: 'recPulse 1.2s ease-in-out infinite' }} />
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: '#ef4444', fontWeight: 600, minWidth: 38 }}>{formatDuration(duration)}</span>
        <button
          className="btn btn-icon"
          onClick={stopRecording}
          style={{ background: '#ef4444', color: 'white', border: 'none' }}
          title="Parar gravacao"
        >
          <Square size={14} />
        </button>
        <style>{`@keyframes recPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }`}</style>
      </div>
    )
  }

  if (phase === 'preview' || phase === 'sending') {
    const sending = phase === 'sending'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: 'rgba(255,179,0,0.08)', border: '1px solid rgba(255,179,0,0.25)', borderRadius: 6 }}>
        <button
          className="btn btn-secondary btn-icon"
          onClick={discardPreview}
          disabled={sending}
          title="Descartar audio"
        >
          <Trash2 size={14} />
        </button>
        {audioUrl && <audio src={audioUrl} controls style={{ height: 28, maxWidth: 200 }} />}
        <button
          className="btn btn-icon"
          onClick={handleSend}
          disabled={sending}
          style={{ background: 'var(--accent, #FFB300)', color: '#000', border: 'none' }}
          title="Enviar audio"
        >
          {sending ? <Loader size={14} className="spin" /> : <Send size={14} />}
        </button>
      </div>
    )
  }

  return null
}
