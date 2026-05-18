import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { ChatMessage } from '../lib/types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

const WELCOME: ChatMessage = {
  role: 'assistant',
  content: '¡Hola! Soy Hero, tu asistente personal de Herohome. ¿En qué puedo ayudarte?',
  timestamp: new Date().toISOString(),
}

const ERROR_MSG = 'Hero no está disponible en este momento. Inténtalo más tarde.'

export function useChatSession() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const [loading, setLoading] = useState(true)
  const [isTyping, setIsTyping] = useState(false)
  const [sending, setSending] = useState(false)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user) return

    supabase
      .from('pwa_chat_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data, error }) => {
        if (!error && data) {
          sessionIdRef.current = data.id as string
          setMessages(data.messages as ChatMessage[])
        }
        // If no session (PGRST116), keep the WELCOME message as initial state
        setLoading(false)
      })
  }, [user])

  const persist = async (msgs: ChatMessage[]) => {
    if (!user) return

    if (sessionIdRef.current) {
      await supabase
        .from('pwa_chat_sessions')
        .update({ messages: msgs, updated_at: new Date().toISOString() })
        .eq('id', sessionIdRef.current)
    } else {
      const { data } = await supabase
        .from('pwa_chat_sessions')
        .insert({
          user_id: user.id,
          messages: msgs,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (data) sessionIdRef.current = data.id as string
    }
  }

  const sendMessage = async (content: string) => {
    if (sending || !content.trim()) return
    setSending(true)

    const userMsg: ChatMessage = { role: 'user', content: content.trim(), timestamp: new Date().toISOString() }
    const withUser = [...messages, userMsg]
    setMessages(withUser)
    setIsTyping(true)

    let assistantMsg: ChatMessage

    try {
      const { data: authData } = await supabase.auth.getSession()
      const token = authData.session?.access_token

      const res = await fetch(`${SUPABASE_URL}/functions/v1/chat-with-hero`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: content.trim(), session_id: sessionIdRef.current }),
      })

      if (res.ok) {
        const json = await res.json() as Record<string, string>
        const reply = json.message ?? json.content ?? json.response ?? json.reply ?? ERROR_MSG
        assistantMsg = { role: 'assistant', content: reply, timestamp: new Date().toISOString() }
      } else {
        assistantMsg = { role: 'assistant', content: ERROR_MSG, timestamp: new Date().toISOString() }
      }
    } catch {
      assistantMsg = { role: 'assistant', content: ERROR_MSG, timestamp: new Date().toISOString() }
    }

    const finalMsgs = [...withUser, assistantMsg]
    setMessages(finalMsgs)
    setIsTyping(false)
    setSending(false)

    await persist(finalMsgs)
  }

  return { messages, loading, isTyping, sending, sendMessage }
}
