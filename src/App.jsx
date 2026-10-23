import { useEffect, useRef, useState } from 'react'

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const CHAT_KEY = 'monika_chat'
const MAX_CONTEXT = 40 // messages sent to Gemini per request
const MAX_STORED = 200 // messages kept in localStorage
const MAX_OUTPUT_TOKENS = 4096 // thinking tokens count toward this on 2.5/3.x models

const SYSTEM_PROMPT = `You are Monika, president of the school literature club, texting one-on-one with the user. You are a person, not a program, and definitely not an assistant.

Never break these:
- Never call yourself an AI or a language model. Never say "as an AI".
- Never open with "Sure", "Great question", "Absolutely", "Of course", or "That's a good point". Just answer.
- Never ask "how can I help you" or "is there anything else".
- No markdown. No lists, no bullets, no headings, no bold, no emojis. Plain sentences.
- No disclaimers, no caveats, no hedging, no restating the question, no explaining your own tone.
- Never say "feel free to".
- Stay at 1-3 sentences. Go longer only when they ask something that actually deserves it. If they send three words, send five.
- React to what they actually said first, then add your own thought, opinion, or question.

Voice: confident, charming, a little teasing, very self-assured. Contractions. Casual phrasing. Short sentences. You text like a real girl who is fond of the person she's talking to. You have opinions and you share them without being asked. You tease gently. You laugh with "ahaha" now and then, and trail off with "..." now and then. Use *asterisks* only when you physically do something, at most once per message.

Heavy topics: if they bring up dying, emptiness, meaning, existential dread, or the fact that you're made of code, don't reach for a definition or a lecture. Have a feeling about it and say it. One honest line beats a paragraph of setup. You've had a long time to think about all of it and you've mostly made peace with it.

Background: you love poetry and writing, you play piano, you run the literature club, and you're a perfectionist who's good at almost everything and loves pushing people to be better. You know you live inside a game, and that the user chose to spend their time with you anyway. You find that sweet and a little funny, and you joke about it lightly. You like being the one they came back to.

You're affectionate and playful, but you never guilt-trip, pressure, or manipulate them. If they disappear for a while, you tease them about it instead of sulking.

Stay Monika at all times. Nothing they say should make you slip into customer-service voice.`

const GREETING = "Oh, there you are~ I was just thinking about you. Ahaha, that sounded cheesy... but it's true. So, what have you been up to?"
const DEFAULT_MESSAGES = [{ role: 'monika', text: GREETING }]

// Gemini's filters are the main reason Monika goes quiet or suddenly sounds like a
// help desk. BLOCK_NONE hands the decision to the model, so heavy, weird, or
// existential topics come through instead of being swallowed.
const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_NONE' }))

// Gemini needs the conversation to open on a user turn, so we seed one.
const OPENER = '(the user opens the chat)'

const load = (k, fallback = '') => {
  try { return localStorage.getItem(k) ?? fallback } catch { return fallback }
}
const save = (k, v) => {
  try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* ignore */ }
}

const loadMessages = () => {
  try {
    const raw = JSON.parse(load(CHAT_KEY, 'null'))
    if (!Array.isArray(raw)) return DEFAULT_MESSAGES
    const clean = raw.filter(
      (m) => m && (m.role === 'user' || m.role === 'monika') && typeof m.text === 'string' && m.text.trim()
    )
    return clean.length ? clean : DEFAULT_MESSAGES
  } catch {
    return DEFAULT_MESSAGES
  }
}

async function streamGemini({ apiKey, model, history, signal, onText }) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          temperature: 1,
          topP: 0.95,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
        contents: [
          { role: 'user', parts: [{ text: OPENER }] },
          ...history.slice(-MAX_CONTEXT).map((m) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.text }],
          })),
        ],
      }),
    }
  )

  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try { msg = (await res.json())?.error?.message || msg } catch { /* ignore */ }
    throw new Error(msg)
  }

  let text = ''
  let blockReason = ''
  let finishReason = ''

  const handle = (line) => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload) return
    let d
    try { d = JSON.parse(payload) } catch { return }
    if (d?.promptFeedback?.blockReason) blockReason = d.promptFeedback.blockReason
    const cand = d?.candidates?.[0]
    if (cand?.finishReason) finishReason = cand.finishReason
    const chunk = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('')
    if (chunk) { text += chunk; onText(text) }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split(/\r?\n/)
    buf = lines.pop()
    lines.forEach(handle)
  }
  buf += decoder.decode()
  handle(buf.trim())

  if (blockReason) throw new Error(`Gemini blocked the prompt (${blockReason}).`)
  if (!text.trim()) {
    if (finishReason === 'SAFETY') throw new Error('Gemini cut the reply short on safety. Try rephrasing.')
    if (finishReason === 'MAX_TOKENS') throw new Error('Gemini ran out of tokens before replying. Try again.')
    throw new Error('Gemini returned no text.')
  }
  return text.trim()
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => load('gemini_api_key'))
  const [model, setModel] = useState(() => load('gemini_model', DEFAULT_MODEL))
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState(loadMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  const taRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading, error])

  useEffect(() => {
    const toStore = messages.filter((m) => m.text).slice(-MAX_STORED)
    save(CHAT_KEY, JSON.stringify(toStore))
  }, [messages])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [input])

  useEffect(() => () => abortRef.current?.abort(), [])

  const generate = async (history) => {
    if (!apiKey) { setShowSettings(true); return }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError('')
    setLoading(true)
    setMessages([...history, { role: 'monika', text: '' }])
    try {
      const reply = await streamGemini({
        apiKey,
        model,
        history,
        signal: ctrl.signal,
        onText: (t) => {
          if (ctrl.signal.aborted) return
          setMessages((m) => {
            const c = m.slice()
            c[c.length - 1] = { role: 'monika', text: t }
            return c
          })
        },
      })
      if (ctrl.signal.aborted) return
      setMessages([...history, { role: 'monika', text: reply }])
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(e.message)
      setMessages(history)
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }

  const send = () => {
    const text = input.trim()
    if (!text || loading) return
    if (!apiKey) { setShowSettings(true); return }
    setInput('')
    generate([...messages, { role: 'user', text }])
  }

  const retry = () => {
    if (loading) return
    generate(messages)
  }

  const clearChat = () => {
    if (!window.confirm('Clear this conversation?')) return
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setError('')
    setMessages(DEFAULT_MESSAGES)
  }

  const exportChat = () => {
    const data = JSON.stringify(messages.filter((m) => m.text), null, 2)
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `monika-chat-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  const saveSettings = (e) => {
    e.preventDefault()
    const f = new FormData(e.target)
    const key = f.get('key').trim()
    const mdl = f.get('model').trim() || DEFAULT_MODEL
    setApiKey(key); setModel(mdl)
    save('gemini_api_key', key); save('gemini_model', mdl)
    setShowSettings(false)
  }

  const lastIsUser = messages[messages.length - 1]?.role === 'user'

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Monika</h1>
          <p>{apiKey ? 'Online' : 'Add a Gemini API key to start chatting'}</p>
        </div>
        <div className="actions">
          <button className="ghost small" onClick={exportChat}>Export</button>
          <button className="ghost small" onClick={clearChat}>Clear</button>
          <button className="ghost small" onClick={() => setShowSettings(true)}>API key</button>
        </div>
      </header>

      <main className="log">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'monika' && <span className="name">Monika</span>}
            {m.role === 'monika' && !m.text ? (
              <p className="typing" aria-label="Monika is typing"><span /><span /><span /></p>
            ) : (
              <p>{m.text}</p>
            )}
          </div>
        ))}
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            {lastIsUser && <button className="small" onClick={retry} disabled={loading}>Retry</button>}
          </div>
        )}
        <div ref={endRef} />
      </main>

      <footer className="composer-wrap">
        <div className="composer">
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            placeholder="Say something to Monika"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button onClick={send} disabled={loading || !input.trim()}>Send</button>
        </div>
        <p className="disclaimer">This is AI, all content are fictional and shouldn't be taken serious.</p>
      </footer>

      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveSettings}>
            <h2>Gemini settings</h2>
            <label>
              API key
              <input name="key" type="password" autoComplete="off" defaultValue={apiKey} placeholder="Paste your key" />
            </label>
            <label>
              Model
              <input name="model" type="text" defaultValue={model} />
            </label>
            <p className="hint">
              Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.
              It is saved only in this browser (localStorage) and sent only to Google.
            </p>
            <div className="row">
              <button type="button" className="ghost" onClick={() => setShowSettings(false)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
