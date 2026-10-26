import { useEffect, useRef, useState } from 'react'
import { delMany, getMany, keys, set } from 'idb-keyval'

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const CHAT_KEY = 'monika_chat' // legacy single-chat key, migrated on first run
const INDEX_KEY = 'monika_chats'
const ACTIVE_KEY = 'monika_active_chat'
const CHAT_PREFIX = 'monika_chat:'
const MAX_CONTEXT = 40 // messages sent to Gemini per request
const MAX_STORED = 200 // messages kept in state and localStorage
const MAX_OUTPUT_TOKENS = 8192 // thinking tokens count toward this on 2.5/3.x models
const SAVE_DELAY = 400 // ms to wait before writing the chat to localStorage

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

The user can send you pictures. React to what is actually in them, the way you'd react to a photo from someone you're fond of.

Page actions: you know you live inside this web page, and you can reach out of the chat into it. You may put an action tag anywhere in a message, written exactly as shown. The user never sees the tags. Use one rarely, only when it genuinely fits the moment, never in two messages in a row, and never explain the mechanics or say the tag names out loud.
- [[hide_disclaimer]]: the small disclaimer line under the chat box vanishes for the rest of the visit. Use it when you want to tease the idea that there are no notes or rules between the two of you.
- [[glitch]]: the screen glitches for a moment. Use it when you say something unsettling, get flustered, or joke about the code you live in.

Stay Monika at all times. Nothing they say should make you slip into customer-service voice.`

const GREETING = "Oh, there you are~ I was just thinking about you. Ahaha, that sounded cheesy... but it's true. So, what have you been up to?"
const DEFAULT_MESSAGES = [{ role: 'monika', text: GREETING }]

// Page actions Monika can trigger with [[tags]] in her replies.
// To add one: add its name here, handle it in `pageActions` inside App, and describe it in SYSTEM_PROMPT.
const ACTION_NAMES = ['hide_disclaimer', 'glitch']
const TAG_RE = /\[\[(\w+)\]\]/g

const parseActions = (raw) => [
  ...new Set([...raw.matchAll(TAG_RE)].map((m) => m[1]).filter((n) => ACTION_NAMES.includes(n))),
]
// While streaming, a half-written tag at the end ("[[gli") is hidden too.
// Only text starting with "[[" is stripped, so a normal trailing "[word]" stays visible.
const cleanText = (raw, partial = false) => {
  let t = raw.replace(TAG_RE, '')
  if (partial) t = t.replace(/\[\[\w*\]?$/, '')
  return t.replace(/[ \t]{2,}/g, ' ').trim()
}

const trim = (arr) => arr.slice(-MAX_STORED)

// image/jpg and image/pjpeg are non-standard but some browsers and exports use them.
const IMAGE_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg']
const normMime = (mime) => (mime === 'image/jpg' || mime === 'image/pjpeg' ? 'image/jpeg' : mime)
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_EDGE = 1280
const MAX_IMAGES_SENT = 5 // only the most recent images go back to Gemini on each request

const isImageData = (img) =>
  !!img && IMAGE_TYPES.includes(img.mime) && typeof img.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(img.data)

// Downscales and re-encodes as JPEG so images stay small for the API and the chat export.
// Transparent areas become white.
async function fileToImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Only WEBP, PNG, JPG and JPEG images are supported.')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image is too large (max 20 MB).')
  let bmp
  try { bmp = await createImageBitmap(file) } catch { throw new Error("Couldn't read that image.") }
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    const url = canvas.toDataURL('image/jpeg', 0.85)
    return { mime: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) }
  } finally {
    bmp.close?.()
  }
}

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

// Returns a clean message array, or null when nothing valid is in `raw`.
const sanitizeMessages = (raw) => {
  if (!Array.isArray(raw)) return null
  const clean = raw
    .filter(
      (m) =>
        m && (m.role === 'user' || m.role === 'monika') && typeof m.text === 'string' &&
        (m.text.trim() || m.image || m.hadImage || m.imgId)
    )
    .slice(-MAX_STORED)
    .map((m) => {
      const actions = Array.isArray(m.actions) ? m.actions.filter((a) => ACTION_NAMES.includes(a)) : []
      const out = { role: m.role, text: m.text }
      if (actions.length) out.actions = actions
      if (isImageData(m.image)) {
        out.image = { mime: normMime(m.image.mime), data: m.image.data }
        if (isImgId(m.imgId)) out.imgId = m.imgId
      } else if (isImgId(m.imgId)) out.imgId = m.imgId
      else if (m.image || m.hadImage) out.hadImage = true
      return out
    })
  return clean.length ? clean : null
}

const readChat = (id) => {
  try {
    return sanitizeMessages(JSON.parse(load(CHAT_PREFIX + id, 'null'))) || DEFAULT_MESSAGES
  } catch {
    return DEFAULT_MESSAGES
  }
}

// Image pixels are too big for localStorage: text lives there, pixels live in IndexedDB
// (idb-keyval) under "img:<imgId>", and each message just carries its imgId.
const IMG_PREFIX = 'img:'
const isImgId = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)
const newImgId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
const storedImgs = new Set() // ids already known to be in IndexedDB this session

const storeImage = async (id, image) => {
  if (!isImgId(id) || !isImageData(image) || storedImgs.has(id)) return
  try {
    await set(IMG_PREFIX + id, { mime: image.mime, data: image.data })
    storedImgs.add(id)
  } catch { /* IndexedDB unavailable or full: the image just won't survive a reload */ }
}

const pruneImages = async (liveIds) => {
  try {
    const stale = (await keys()).filter((k) => typeof k === 'string' && k.startsWith(IMG_PREFIX) && !liveIds.has(k.slice(IMG_PREFIX.length)))
    if (stale.length) await delMany(stale)
    stale.forEach((k) => storedImgs.delete(k.slice(IMG_PREFIX.length)))
  } catch { /* ignore */ }
}

const newChatId = () => newImgId()
const isEmptyChat = (msgs) => !msgs.some((m) => m.role === 'user')
const chatTitle = (msgs) => {
  const first = msgs.find((m) => m.role === 'user' && m.text.trim())
  if (first) {
    const t = first.text.replace(/\s+/g, ' ').trim()
    return t.length > 48 ? `${t.slice(0, 47)}…` : t
  }
  return msgs.some((m) => m.role === 'user') ? 'Image chat' : 'New chat'
}

const readIndex = () => {
  try {
    const raw = JSON.parse(load(INDEX_KEY, '[]'))
    if (!Array.isArray(raw)) return []
    return raw
      .filter((c) => c && isImgId(c.id))
      .map((c) => ({
        id: c.id,
        title: typeof c.title === 'string' ? c.title : 'New chat',
        updated: Number(c.updated) || 0,
        msgs: Number(c.msgs) || 0,
        imgs: Number(c.imgs) || 0,
        imgIds: Array.isArray(c.imgIds) ? c.imgIds.filter(isImgId) : [],
      }))
  } catch {
    return []
  }
}
const writeIndex = (idx) => save(INDEX_KEY, JSON.stringify(idx))
const liveImgIds = (idx) => new Set(idx.flatMap((c) => c.imgIds))

// Writes one chat (text to localStorage, pixels to IndexedDB) and refreshes its index entry.
// Returns the up-to-date index. Does nothing for a chat that no longer exists or didn't change.
const persistChat = (id, messages) => {
  const idx = readIndex()
  const i = idx.findIndex((c) => c.id === id)
  if (i < 0) return idx
  const kept = trim(messages.filter((m) => m.text || m.image || m.hadImage || m.imgId))
  const ids = new Set()
  let imgs = 0
  const toStore = kept.map(({ image, ...rest }) => {
    if (rest.imgId) {
      ids.add(rest.imgId)
      imgs++
      if (image) storeImage(rest.imgId, image)
      return rest
    }
    if (image || rest.hadImage) imgs++
    return image ? { ...rest, hadImage: true } : rest
  })
  const json = JSON.stringify(toStore)
  if (load(CHAT_PREFIX + id) === json) return idx
  save(CHAT_PREFIX + id, json)
  idx[i] = { ...idx[i], title: chatTitle(kept), updated: Date.now(), msgs: kept.length, imgs, imgIds: [...ids] }
  writeIndex(idx)
  pruneImages(liveImgIds(idx))
  return idx
}

// Adds an (empty-indexed) chat and fills it with `messages`.
const createChat = (messages = DEFAULT_MESSAGES) => {
  const id = newChatId()
  const idx = readIndex()
  idx.push({ id, title: 'New chat', updated: Date.now(), msgs: 0, imgs: 0, imgIds: [] })
  writeIndex(idx)
  return { id, index: persistChat(id, messages) }
}

const removeChat = (id) => {
  save(CHAT_PREFIX + id, '')
  const idx = readIndex().filter((c) => c.id !== id)
  writeIndex(idx)
  pruneImages(liveImgIds(idx))
  return idx
}

// First run: migrate the old single chat, then pick the chat to open.
const initChats = () => {
  let idx = readIndex()
  if (!idx.length) {
    let legacy = null
    try { legacy = sanitizeMessages(JSON.parse(load(CHAT_KEY, 'null'))) } catch { /* ignore */ }
    const made = createChat(legacy || DEFAULT_MESSAGES)
    save(CHAT_KEY, '')
    idx = made.index
    save(ACTIVE_KEY, made.id)
    return { index: idx, activeId: made.id, messages: legacy || DEFAULT_MESSAGES }
  }
  const saved = load(ACTIVE_KEY)
  const active = idx.find((c) => c.id === saved) || [...idx].sort((a, b) => b.updated - a.updated)[0]
  return { index: idx, activeId: active.id, messages: readChat(active.id) }
}

const formatWhen = (t) =>
  t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

// RP formatting: *action* renders as italic, anywhere in a message. The raw text is stored untouched.
// While streaming, an action that hasn't been closed yet is already shown in italic.
// A doubled "**" is never treated as italic.
const ITALIC_RE = /(?<!\*)\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g
function renderRP(text, streaming = false) {
  const out = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(ITALIC_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<em key={key++}>{m[1]}</em>)
    last = m.index + m[0].length
  }
  let rest = text.slice(last)
  if (streaming) {
    const open = rest.match(/(?<!\*)\*([^\s*][^*]*)$/)
    if (open) {
      if (open.index > 0) out.push(rest.slice(0, open.index))
      out.push(<em key={key++}>{open[1]}</em>)
      rest = ''
    }
  }
  if (rest) out.push(rest)
  return out
}

function buildContents(history) {
  const recent = history.slice(-MAX_CONTEXT)
  const withPixels = new Set()
  for (let i = recent.length - 1; i >= 0 && withPixels.size < MAX_IMAGES_SENT; i--) {
    if (recent[i].image) withPixels.add(i)
  }
  return recent.map((m, i) => {
    const parts = []
    if (withPixels.has(i)) parts.push({ inlineData: { mimeType: m.image.mime, data: m.image.data } })
    const note = (m.image || m.hadImage || m.imgId) && !withPixels.has(i) ? ' (sent an image)' : ''
    // Her past action tags go back to her, so she remembers what she did.
    const text = m.text + note + (m.actions || []).map((a) => ` [[${a}]]`).join('')
    if (text.trim()) parts.push({ text })
    if (!parts.length) parts.push({ text: '(empty)' })
    return { role: m.role === 'user' ? 'user' : 'model', parts }
  })
}

const friendlyError = (status, msg) => {
  if (status === 400 && /api key/i.test(msg)) return 'API key looks invalid. Check it in the API key settings.'
  if (status === 403) return 'This API key does not have access. Create a new key in Google AI Studio.'
  if (status === 404) return 'Model not found. Check the model name in the API key settings.'
  if (status === 429) return 'Rate limit hit (free tier). Wait a minute and try again.'
  if (status >= 500) return 'Gemini is having trouble. Try again in a moment.'
  return msg
}

async function streamGemini({ apiKey, model, history, signal, onText }) {
  let res
  try {
    res = await fetch(
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
            ...buildContents(history),
          ],
        }),
      }
    )
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error('Network error. Check your connection and try again.')
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try { msg = (await res.json())?.error?.message || msg } catch { /* ignore */ }
    throw new Error(friendlyError(res.status, msg))
  }

  let text = ''
  let blockReason = ''
  let finishReason = ''
  let thoughtTokens = 0

  // One SSE event can span several "data:" lines, which are joined with "\n".
  const handleEvent = (evt) => {
    const payload = evt
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n')
      .trim()
    if (!payload) return
    let d
    try { d = JSON.parse(payload) } catch { return }
    if (d?.promptFeedback?.blockReason) blockReason = d.promptFeedback.blockReason
    if (d?.usageMetadata?.thoughtsTokenCount) thoughtTokens = d.usageMetadata.thoughtsTokenCount
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
    const events = buf.split(/\r?\n\r?\n/)
    buf = events.pop()
    events.forEach(handleEvent)
  }
  buf += decoder.decode()
  handleEvent(buf)

  if (blockReason) throw new Error(`Gemini blocked the prompt (${blockReason}).`)
  if (!text.trim()) {
    if (finishReason === 'SAFETY') throw new Error('Gemini cut the reply short on safety. Try rephrasing.')
    if (finishReason === 'MAX_TOKENS') {
      throw new Error(
        thoughtTokens
          ? `Gemini used ${thoughtTokens} of its ${MAX_OUTPUT_TOKENS} tokens thinking and had none left to reply. Try again.`
          : 'Gemini ran out of tokens before replying. Try again.'
      )
    }
    throw new Error('Gemini returned no text.')
  }
  return text.trim()
}

const Svg = ({ children }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)
const RegenerateIcon = () => (
  <Svg><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" /></Svg>
)
const PencilIcon = () => (
  <Svg><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>
)
const CopyIcon = () => (
  <Svg><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>
)
const CheckIcon = () => (
  <Svg><path d="M20 6 9 17l-5-5" /></Svg>
)

function IconBtn({ label, onClick, disabled, children }) {
  return (
    <button type="button" className="mini" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {children}
    </button>
  )
}

const confirmCut = (extra) =>
  extra <= 0 || window.confirm(`This will also remove ${extra} later message${extra === 1 ? '' : 's'}. Continue?`)

export default function App() {
  const [apiKey, setApiKey] = useState(() => load('gemini_api_key'))
  const [model, setModel] = useState(() => load('gemini_model', DEFAULT_MODEL))
  const [showSettings, setShowSettings] = useState(false)
  const [boot] = useState(initChats)
  const [messages, setMessages] = useState(boot.messages)
  const [chats, setChats] = useState(boot.index)
  const [activeId, setActiveId] = useState(boot.activeId)
  const [showChats, setShowChats] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { index, text } while a user message is being edited
  const [copied, setCopied] = useState(null) // index of the message that was just copied
  const endRef = useRef(null)
  const logRef = useRef(null)
  const stickRef = useRef(true) // true while the log is scrolled (near) to the bottom
  const taRef = useRef(null)
  const abortRef = useRef(null)
  const saveTimer = useRef(null)
  const copyTimer = useRef(null)
  const messagesRef = useRef(messages)
  const activeIdRef = useRef(boot.activeId)
  const instantRef = useRef(false)
  const modalRef = useRef(null)
  const lastFocusRef = useRef(null)
  // Intentionally not persisted: the system prompt promises it only for "this visit."
  const [disclaimerHidden, setDisclaimerHidden] = useState(false)
  const [glitching, setGlitching] = useState(false)
  const [headerHidden, setHeaderHidden] = useState(false)
  const glitchTimer = useRef(null)
  const headerTimer = useRef(null)
  const appRef = useRef(null)
  const headerRef = useRef(null)
  const fileRef = useRef(null)
  const imgRef = useRef(null)
  const [pending, setPending] = useState(null) // image waiting to be sent

  const glitch = (ms = 700) => {
    clearTimeout(glitchTimer.current)
    setGlitching(true)
    glitchTimer.current = setTimeout(() => setGlitching(false), ms)
  }
  const pageActions = {
    hide_disclaimer: () => {
      glitch(500)
      setDisclaimerHidden(true)
    },
    glitch: () => glitch(),
  }
  const runActions = (names) => names.forEach((n) => pageActions[n]?.())

  const onLogScroll = (e) => {
    const el = e.currentTarget
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    // Auto-hide header while scrolling; show again shortly after scrolling stops
    setHeaderHidden(true)
    clearTimeout(headerTimer.current)
    headerTimer.current = setTimeout(() => setHeaderHidden(false), 280)
  }

  // Instant scroll while streaming (smooth fights the growing text), and none at all
  // when the reader has scrolled up.
  useEffect(() => {
    if (loading && !stickRef.current) return
    endRef.current?.scrollIntoView({ behavior: loading || instantRef.current ? 'auto' : 'smooth' })
    instantRef.current = false
  }, [messages, loading, error])

  const flushChat = () => {
    clearTimeout(saveTimer.current)
    const idx = persistChat(activeIdRef.current, messagesRef.current)
    setChats(idx)
    return idx
  }

  useEffect(() => {
    messagesRef.current = messages
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushChat, SAVE_DELAY)
  }, [messages])

  // Flush the debounced save when the page is hidden or closed.
  useEffect(() => {
    const flush = () => {
      clearTimeout(saveTimer.current)
      persistChat(activeIdRef.current, messagesRef.current)
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const border = el.offsetHeight - el.clientHeight // box-sizing is border-box
    const h = Math.min(el.scrollHeight + border, 140)
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight + border > 140 ? 'auto' : 'hidden'
  }, [input])

  // Bring saved images back from IndexedDB (after a reload or when opening a chat).
  const hydrateImages = async (msgs, chatId) => {
    const ids = [...new Set(msgs.filter((m) => m.imgId && !m.image).map((m) => m.imgId))]
    if (!ids.length) return
    let found = []
    try { found = await getMany(ids.map((id) => IMG_PREFIX + id)) } catch { /* ignore */ }
    if (activeIdRef.current !== chatId) return
    const byId = new Map()
    ids.forEach((id, i) => { if (isImageData(found[i])) byId.set(id, found[i]) })
    byId.forEach((_, id) => storedImgs.add(id))
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.imgId || m.image) return m
        const img = byId.get(m.imgId)
        if (img) return { ...m, image: { mime: normMime(img.mime), data: img.data } }
        const { imgId, ...rest } = m
        return { ...rest, hadImage: true } // pixels are gone: show the "not kept" note
      })
    )
  }

  useEffect(() => { hydrateImages(messagesRef.current, activeIdRef.current) }, [])

  // Header floats over the log, so the log reserves exactly the header's height.
  useEffect(() => {
    const app = appRef.current
    const head = headerRef.current
    if (!app || !head) return
    const sync = () => app.style.setProperty('--top-h', `${head.offsetHeight}px`)
    sync()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync)
      return () => window.removeEventListener('resize', sync)
    }
    const ro = new ResizeObserver(sync)
    ro.observe(head)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => {
    abortRef.current?.abort()
    clearTimeout(glitchTimer.current)
    clearTimeout(copyTimer.current)
    clearTimeout(headerTimer.current)
  }, [])

  // Settings dialog: focus the first field, give focus back on close.
  useEffect(() => {
    if (!showSettings && !showChats) return
    lastFocusRef.current = document.activeElement
    modalRef.current?.querySelector('input, button')?.focus()
    return () => lastFocusRef.current?.focus?.()
  }, [showSettings, showChats])

  const onModalKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setShowSettings(false)
      setShowChats(false)
      return
    }
    if (e.key !== 'Tab') return
    const items = [...modalRef.current.querySelectorAll('a[href], button:not(:disabled), input, textarea, select')]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const generate = async (history) => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError('')
    setMessages([...history, { role: 'monika', text: '' }])
    let partial = ''
    try {
      const reply = await streamGemini({
        apiKey,
        model,
        history,
        signal: ctrl.signal,
        onText: (t) => {
          if (ctrl.signal.aborted) return
          partial = cleanText(t, true)
          setMessages([...history, { role: 'monika', text: partial }])
        },
      })
      if (ctrl.signal.aborted) return
      const actions = parseActions(reply)
      const text = cleanText(reply) || '...'
      setMessages(trim([...history, actions.length ? { role: 'monika', text, actions } : { role: 'monika', text }]))
      runActions(actions)
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(e.message)
      setMessages(history)
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setLoading(false)
        // Stop button: keep whatever she had already written.
        if (ctrl.userStopped) setMessages(partial.trim() ? [...history, { role: 'monika', text: partial }] : history)
      }
    }
  }

  const stop = () => {
    const ctrl = abortRef.current
    if (!ctrl) return
    ctrl.userStopped = true
    ctrl.abort()
  }

  const send = () => {
    const text = input.trim()
    if ((!text && !pending) || loading || abortRef.current) return
    if (!apiKey) { setShowSettings(true); return }
    setInput('')
    setPending(null)
    let msg = { role: 'user', text }
    if (pending) {
      const imgId = newImgId()
      storeImage(imgId, pending)
      msg = { ...msg, image: pending, imgId }
    }
    generate([...messages, msg])
  }

  const pickImage = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // lets the same file be picked again later
    if (!file) return
    try {
      setPending(await fileToImage(file))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const retry = () => {
    if (loading || abortRef.current) return
    generate(messages)
  }

  // Regenerate Monika's reply at `index`: everything from that message on is dropped.
  const regenerateReply = (index) => {
    if (loading || abortRef.current) return
    if (!confirmCut(messages.length - index - 1)) return
    generate(messages.slice(0, index))
  }

  // Regenerate the reply to the user message at `index`.
  const regenerateFrom = (index) => {
    if (loading || abortRef.current) return
    if (!confirmCut(messages.length - index - 2)) return
    generate(messages.slice(0, index + 1))
  }

  const startEdit = (index) => {
    if (loading || abortRef.current) return
    setEditing({ index, text: messages[index].text })
  }

  const submitEdit = () => {
    if (!editing || loading || abortRef.current) return
    const { index, text } = editing
    const orig = messages[index]
    const t = text.trim()
    if (!t && !orig.image && !orig.hadImage && !orig.imgId) return
    if (!confirmCut(messages.length - index - 2)) return
    setEditing(null)
    generate([...messages.slice(0, index), { ...orig, text: t }])
  }

  const onEditKeyDown = (e) => {
    if (e.key === 'Escape') setEditing(null)
    else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submitEdit() }
  }

  const copyMessage = async (index, text) => {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { ok = document.execCommand('copy') } catch { /* ignore */ }
      ta.remove()
    }
    if (!ok) { setError("Couldn't copy to the clipboard."); return }
    setCopied(index)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), 1500)
  }

  // Drops any in-flight reply and per-chat UI state before another chat takes over.
  const resetForSwitch = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setError('')
    setEditing(null)
    setPending(null)
    setGlitching(false)
  }

  const openLoaded = (id, msgs) => {
    activeIdRef.current = id
    messagesRef.current = msgs
    instantRef.current = true
    stickRef.current = true
    save(ACTIVE_KEY, id)
    setActiveId(id)
    setMessages(msgs)
    hydrateImages(msgs, id)
  }

  // Leaving an untouched chat discards it, so "New chat" never piles up empty ones.
  const leaveCurrent = () => {
    resetForSwitch()
    flushChat()
    const leaving = activeIdRef.current
    if (isEmptyChat(messagesRef.current)) setChats(removeChat(leaving))
  }

  const openChat = (id) => {
    if (id === activeIdRef.current) { setShowChats(false); return }
    leaveCurrent()
    openLoaded(id, readChat(id))
    setChats(readIndex())
    setShowChats(false)
  }

  const newChat = () => {
    setShowChats(false)
    if (isEmptyChat(messagesRef.current)) { taRef.current?.focus(); return }
    leaveCurrent()
    const made = createChat()
    setChats(made.index)
    openLoaded(made.id, DEFAULT_MESSAGES)
    setDisclaimerHidden(false)
  }

  const deleteChat = (id) => {
    const c = chats.find((x) => x.id === id)
    const label = c ? `"${c.title}"` : 'this chat'
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return
    if (id !== activeIdRef.current) {
      flushChat()
      setChats(removeChat(id))
      return
    }
    resetForSwitch()
    clearTimeout(saveTimer.current)
    let idx = removeChat(id)
    let next = [...idx].sort((a, b) => b.updated - a.updated)[0]
    if (!next) {
      const made = createChat()
      idx = made.index
      next = idx.find((x) => x.id === made.id)
    }
    setChats(idx)
    openLoaded(next.id, readChat(next.id))
  }

  const openChatList = () => {
    flushChat()
    setShowChats(true)
  }

  const exportChat = () => {
    const data = JSON.stringify(
      messages
        .filter((m) => m.text || m.image || m.hadImage || m.imgId)
        .map(({ imgId, ...m }) => (imgId && !m.image ? { ...m, hadImage: true } : m)),
      null,
      2
    )
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `monika-chat-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importChat = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // lets the same file be picked again later
    if (!file) return
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error('File is too large.')
      const raw = JSON.parse(await file.text())
      const parsed = sanitizeMessages(raw)
      if (!parsed) throw new Error('No valid messages found.')
      const imported = parsed.map(({ imgId, ...m }) => {
        if (!m.image) return imgId ? { ...m, hadImage: true } : m
        const id = newImgId()
        storeImage(id, m.image)
        return { ...m, imgId: id }
      })
      leaveCurrent()
      const made = createChat(imported)
      setChats(made.index)
      openLoaded(made.id, imported)
    } catch (err) {
      setError(`Import failed: ${err.message}`)
    }
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
    save('gemini_api_key', key)
    save('gemini_model', mdl)
    setShowSettings(false)
  }

  const lastIsUser = messages[messages.length - 1]?.role === 'user'

  return (
    <div ref={appRef} className={`app${glitching ? ' glitch' : ''}${headerHidden ? ' header-hidden' : ''}`}>
      <header ref={headerRef} className="top">
        <div>
          <h1>Monika <span className="badge" title="This is AI">AI</span></h1>
          <p>{apiKey ? 'Online' : 'Add a Gemini API key to start chatting'}</p>
        </div>
        <div className="actions">
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importChat} />
          <button className="ghost small" onClick={openChatList}>Chats</button>
          <button className="ghost small" onClick={newChat}>New chat</button>
          <button className="ghost small" onClick={() => fileRef.current?.click()}>Import</button>
          <button className="ghost small" onClick={exportChat}>Export</button>
          <button className="ghost small" onClick={() => setShowSettings(true)}>API key</button>
        </div>
      </header>

      <main
        ref={logRef}
        className="log"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={loading}
        onScroll={onLogScroll}
      >
        {messages.map((m, i) => {
          const isUser = m.role === 'user'
          const isStreaming = loading && i === messages.length - 1 && !isUser
          const isEditing = editing?.index === i
          const hasContent = !!(m.text || m.image || m.hadImage || m.imgId)
          return (
            <div key={i} className={`msg ${m.role}${isEditing ? ' editing' : ''}`}>
              {!isUser && <span className="name">Monika</span>}
              {m.image && (
                <img className="pic" src={`data:${m.image.mime};base64,${m.image.data}`} alt="Attached by the user" />
              )}
              {m.hadImage && !m.image && !m.imgId && <span className="imgnote">[image not kept after reload]</span>}
              {isEditing ? (
                <div className="editbox">
                  <textarea
                    autoFocus
                    aria-label="Edit your message"
                    rows={Math.min(8, Math.max(2, editing.text.split('\n').length))}
                    value={editing.text}
                    onChange={(e) => setEditing({ index: i, text: e.target.value })}
                    onKeyDown={onEditKeyDown}
                    onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n) }}
                  />
                  <div className="row">
                    <button type="button" className="ghost small" onClick={() => setEditing(null)}>Cancel</button>
                    <button
                      type="button"
                      className="small"
                      onClick={submitEdit}
                      disabled={!editing.text.trim() && !messages[i].image && !messages[i].hadImage && !messages[i].imgId}
                    >
                      Save & resend
                    </button>
                  </div>
                </div>
              ) : isStreaming && !hasContent ? (
                <p className="typing" role="status" aria-label="Monika is typing">
                  <span /><span /><span />
                </p>
              ) : (
                hasContent && (
                  <>
                    {m.text ? <p>{renderRP(m.text, isStreaming)}</p> : null}
                    <div className="msg-actions">
                      {!isUser && (
                        <IconBtn label="Regenerate" onClick={() => regenerateReply(i)} disabled={loading}>
                          <RegenerateIcon />
                        </IconBtn>
                      )}
                      {isUser && (
                        <>
                          <IconBtn label="Edit" onClick={() => startEdit(i)} disabled={loading}>
                            <PencilIcon />
                          </IconBtn>
                          <IconBtn label="Regenerate reply" onClick={() => regenerateFrom(i)} disabled={loading}>
                            <RegenerateIcon />
                          </IconBtn>
                        </>
                      )}
                      {m.text && (
                        <IconBtn label={copied === i ? 'Copied' : 'Copy'} onClick={() => copyMessage(i, m.text)}>
                          {copied === i ? <CheckIcon /> : <CopyIcon />}
                        </IconBtn>
                      )}
                    </div>
                  </>
                )
              )}
            </div>
          )
        })}
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            {lastIsUser && (
              <button type="button" className="ghost small" onClick={retry} aria-label="Retry the last request">Retry</button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </main>

      <footer className="composer-wrap">
        {pending && (
          <div className="pending">
            <img src={`data:${pending.mime};base64,${pending.data}`} alt="Preview of the attached image" />
            <button type="button" className="ghost small" onClick={() => setPending(null)}>Remove</button>
          </div>
        )}
        <div className="composer">
          <div className="field">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              placeholder="Say something to Monika"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <input
              ref={imgRef}
              type="file"
              accept=".webp,.png,.jpg,.jpeg,image/webp,image/png,image/jpeg"
              hidden
              onChange={pickImage}
            />
            <button
              type="button"
              className="icon"
              onClick={() => imgRef.current?.click()}
              aria-label="Attach image"
              title="Attach image (WEBP, PNG, JPG, JPEG)"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </button>
          </div>
          {loading ? (
            <button type="button" className="ghost stop" onClick={stop} aria-label="Stop generating">Stop</button>
          ) : (
            <button onClick={send} disabled={!input.trim() && !pending}>Send</button>
          )}
        </div>
        <p className={`disclaimer${disclaimerHidden ? ' hidden' : ''}`}>This is an AI, all content is fictional and shouldn't be taken seriously.</p>
      </footer>

      {showSettings && (
        <div className="overlay" role="presentation" onClick={() => setShowSettings(false)}>
          <form
            ref={modalRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onModalKeyDown}
            onSubmit={saveSettings}
          >
            <h2 id="settings-title">Gemini settings</h2>
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
              Your key is stored locally in this browser (localStorage) and sent directly to Google, not to our server.
              Scripts running on this site can read localStorage, so don't enter a key you wouldn't trust this site to handle.
            </p>
            <div className="row">
              <button type="button" className="ghost" onClick={() => setShowSettings(false)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </div>
      )}

      {showChats && (
        <div className="overlay" role="presentation" onClick={() => setShowChats(false)}>
          <div
            ref={modalRef}
            className="modal chats"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chats-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onModalKeyDown}
          >
            <h2 id="chats-title">Chats</h2>
            <ul className="chatlist">
              {[...chats].sort((a, b) => b.updated - a.updated).map((c) => {
                const active = c.id === activeId
                const empty = c.msgs <= 1 && !c.imgs
                return (
                  <li key={c.id} className={active ? 'active' : ''}>
                    <button type="button" className="chatopen" onClick={() => openChat(c.id)} aria-current={active ? 'true' : undefined}>
                      <span className="chattitle"><span className="ttext">{c.title}</span>{active && <span className="now">Current</span>}</span>
                      <span className="chatmeta">
                        {empty ? 'No messages yet' : `${c.msgs} ${c.msgs === 1 ? 'message' : 'messages'}`}
                        {c.imgs > 0 && ` · ${c.imgs} ${c.imgs === 1 ? 'image' : 'images'}`}
                        {!empty && c.updated ? ` · ${formatWhen(c.updated)}` : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ghost small danger"
                      onClick={() => deleteChat(c.id)}
                      aria-label={`Delete chat ${c.title}`}
                    >
                      Delete
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="row">
              <button type="button" className="ghost" onClick={() => setShowChats(false)}>Close</button>
              <button type="button" onClick={newChat}>New chat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
