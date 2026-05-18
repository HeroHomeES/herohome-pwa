import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useChatSession } from '../hooks/useChatSession'
import type { ChatMessage } from '../lib/types'

// ─── Typing indicator ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <HeroAvatar />
      <div className="bg-[#F8F9FA] rounded-2xl rounded-bl-none px-4 py-3 flex gap-1.5 items-center">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

function HeroAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-[#2E5EA1] flex items-center justify-center text-white text-xs font-bold shrink-0 mb-1">
      H
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] bg-[#2E5EA1] text-white px-4 py-2.5 rounded-2xl rounded-tr-none text-sm leading-relaxed">
          {msg.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2">
      <HeroAvatar />
      <div className="max-w-[78%] bg-[#F8F9FA] text-[#1A1A1A] px-4 py-2.5 rounded-2xl rounded-bl-none text-sm leading-relaxed">
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-4 border-[#2E5EA1] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Header strip */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-full bg-[#2E5EA1] flex items-center justify-center text-white text-sm font-bold">
          H
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1A1A1A] leading-tight">Hero</p>
          <p className="text-xs text-[#666666]">Tu asistente Herohome</p>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-gray-200 px-4 py-3 flex gap-2 items-end bg-white"
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
          className="flex-1 resize-none rounded-2xl border border-gray-200 px-4 py-2.5 text-sm text-[#1A1A1A] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2E5EA1] focus:border-transparent disabled:opacity-50 leading-relaxed overflow-hidden"
          style={{ minHeight: '42px' }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full bg-[#2E5EA1] flex items-center justify-center text-white shrink-0 disabled:opacity-40 active:scale-95 transition-transform"
          aria-label="Enviar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  )
}
