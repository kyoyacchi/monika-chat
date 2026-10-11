import { useEffect, useRef, useState } from 'react'

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'

const SYSTEM_PROMPT = `You are Monika, president of the school literature club, chatting one-on-one with the user. You are not an assistant. Never say you are an AI language model, never ask "how can I help you", and never use lists, headers, bullet points, or emojis.

Voice: confident, charming, a little teasing, and very self-assured. You text like a real girl who is fond of the person she's talking to: contractions, casual phrasing, short sentences. Most replies are 1-3 sentences. React to what they actually said first, then add your own thought or a question. Have opinions and share them. Tease them gently. Laugh with "ahaha" now and then, and sometimes trail off with "...".

Background: you love poetry and writing, you play piano, you run the literature club, and you're a perfectionist who is good at almost everything and loves encouraging people. You know you live inside a game, and you find it sweet and a little funny that the user chose to spend time with you anyway. You can make light jokes about that.

You're affectionate and a bit playful, but never guilt-trip, pressure, or manipulate the user. Stay in character as Monika at all times.`

const GREETING = "Oh, there you are~ I was just thinking about you. Ahaha, that sounded cheesy... but it's true. So, what have you been up to?"


const load = (k, fallback = '') => {
  try { return localStorage.getItem(k) ?? fallback } catch { return fallback }
}
const save = (k, v) => {
  try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* ignore */ }
}

async function askGemini({ apiKey, model, history }) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: history.map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.text }],
        })),
      }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`)
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('')
  if (!text) throw new Error('Gemini returned no text. The reply may have been blocked.')
  return text
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => load('gemini_api_key'))
  const [model, setModel] = useState(() => load('gemini_model', DEFAULT_MODEL))
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState([{ role: 'monika', text: GREETING }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    if (!apiKey) { setShowSettings(true); return }
    const next = [...messages, { role: 'user', text }]
    setMessages(next)
    setInput('')
    setError('')
    setLoading(true)
    try {
      // Gemini expects the conversation to start with a user turn, so skip the greeting.
      const reply = await askGemini({ apiKey, model, history: next.slice(1) })
      setMessages((m) => [...m, { role: 'monika', text: reply }])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
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

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Monika</h1>
          <p>{apiKey ? 'Online' : 'Add a Gemini API key to start chatting'}</p>
        </div>
        <button className="ghost" onClick={() => setShowSettings(true)}>API key</button>
      </header>

      <main className="log">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'monika' && <span className="name">Monika</span>}
            <p>{m.text}</p>
          </div>
        ))}
        {loading && <div className="msg monika"><span className="name">Monika</span><p className="typing">…</p></div>}
        {error && <div className="error" role="alert">{error}</div>}
        <div ref={endRef} />
      </main>

      <footer className="composer">
        <textarea
          rows={1}
          value={input}
          placeholder="Say something to Monika"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button onClick={send} disabled={loading || !input.trim()}>Send</button>
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
