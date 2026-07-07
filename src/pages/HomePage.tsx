import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useChatSession } from '../hooks/useChatSession'
import { HerohomeSymbol } from '../components/HerohomeLogo'
import { IconSend } from '../components/icons'
import type { ChatMessage } from '../lib/types'

// Sugerencias rápidas — solo al inicio de la conversación
const SUGGESTIONS = ['Ver mis visitas', '¿Tengo ofertas nuevas?', 'Bloquear un día']

// ─── Hero avatar (símbolo Pulse sobre círculo violeta) ───────────────────────

function HeroAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-violet flex items-center justify-center shrink-0 mb-1">
      <HerohomeSymbol size={14} onViolet />
    </div>
  )
}

// ─── Typing indicator ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <HeroAvatar />
      <div className="bg-white border border-line rounded-2xl rounded-bl-[4px] px-4 py-3 flex gap-1.5 items-center">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-2 h-2 bg-slate-light rounded-full animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] bg-violet text-white px-4 py-2.5 rounded-2xl rounded-br-[4px] text-sm leading-relaxed">
          {msg.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2">
      <HeroAvatar />
      <div className="max-w-[78%] bg-white border border-line text-ink px-4 py-2.5 rounded-2xl rounded-bl-[4px] text-sm leading-relaxed">
        {msg.content}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { messages, loading, isTyping, sending, sendMessage } = useChatSession()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or typing indicator
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || sending) return
    const text = input
    setInput('')
    await sendMessage(text)
  }

  const handleSuggestion = async (text: string) => {
    if (sending) return
    await sendMessage(text)
  }

  const showSuggestions = !loading && messages.length <= 2 && !isTyping

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-112px-env(safe-area-inset-bottom))]">
        <div className="w-8 h-8 border-4 border-violet border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-112px-env(safe-area-inset-bottom))]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {isTyping && <TypingIndicator />}
        {showSuggestions && (
          <div className="flex gap-2 flex-wrap pl-9">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                disabled={sending}
                className="text-xs font-medium text-violet-dark bg-violet-light border border-violet-light rounded-full px-3 py-1.5 hover:border-violet-dark transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-line px-4 py-3 flex gap-2 items-end bg-white"
      >
        <textarea
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e as unknown as FormEvent)
            }
          }}
          placeholder="Escribe un mensaje…"
          disabled={sending}
          className="flex-1 resize-none rounded-2xl border border-line px-4 py-2.5 text-sm text-ink placeholder-slate-light focus:outline-none focus:border-violet focus:ring-[3px] focus:ring-violet/12 disabled:opacity-50 leading-relaxed overflow-hidden"
          style={{ minHeight: '42px' }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full bg-violet hover:bg-violet-dark flex items-center justify-center text-white shrink-0 disabled:opacity-40 active:scale-95 transition"
          aria-label="Enviar"
        >
          <IconSend size={17} strokeWidth={2} />
        </button>
      </form>
    </div>
  )
}
