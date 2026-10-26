<div align="center">

# Monika Chat

**Speak with your own Monika! Just Monika.**

A small, fast, bring-your-own-key chat app for roleplaying with Monika from *Doki Doki Literature Club*, powered by the Google Gemini API.

[**Live demo**](https://monika.kyokai.me) · [Report a bug](https://github.com/kyoyacchi/monika-chat/issues) · [Request a feature](https://github.com/kyoyacchi/monika-chat/issues)

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini%20API-4285F4?logo=googlegemini&logoColor=white)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)

</div>

---

## About

Monika Chat is a lightweight web client that lets you talk to Monika through Google's Gemini models. There is no backend and no account system: the app runs entirely in your browser and talks to the Gemini API directly with **your own API key**.

## Features

- Chat with Monika in a roleplay-style conversation
- **She can interact with the site itself:**
  - Remove the on-page disclaimer text on her own
  - Trigger an instant glitch effect on the screen
  - Stay aware of where she is talking (she knows she is inside the site)
  - Send images to Monika and chat about them (image input supported)
- Powered by the Gemini API, mostly using **Flash Lite** models
- No server, no sign-up, no tracking
- Your API key never leaves your browser (stored only in `localStorage`)
- Fast dev and build experience thanks to Vite

## Roadmap

- [ ] Thinking mode with adjustable levels (low, medium, high) for free models
- [ ] More interaction control over the site
- [ ] A smoother, more fluid interface

## Try it

The hosted version is live at **[monika.kyokai.me](https://monika.kyokai.me)**. Open it, click **API key**, paste your Gemini key, and start chatting.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 18 or newer
- A free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

### Run locally

```bash
# 1. Clone the repository
git clone https://github.com/kyoyacchi/monika-chat.git
cd monika-chat

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Then open the local URL printed in your terminal (usually `http://localhost:5173`).

### Add your API key

1. Open the app and click **API key**.
2. Paste your Gemini key from [Google AI Studio](https://aistudio.google.com/apikey).
3. Start talking to Monika.

> **Privacy note:** No key is bundled with the app. Your key is stored only in your browser's `localStorage` and is sent only to Google's Gemini API. Clearing your site data removes it.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Create an optimized production build in `dist/` |
| `npm run preview` | Preview the production build locally |

## Tech stack

- [React 18](https://react.dev)
- [Vite 5](https://vite.dev) with `@vitejs/plugin-react`
- [Google Gemini API](https://ai.google.dev)

## Project structure

```
monika-chat/
├── src/             # Application source
├── index.html       # App entry point
├── vite.config.js   # Vite configuration
└── package.json
```

## Deployment

Since this is a static Vite app, you can host the `dist/` folder anywhere that serves static files (Vercel, Netlify, Cloudflare Pages, GitHub Pages, and so on):

```bash
npm run build
```

## Contributing

Issues and pull requests are welcome. If you plan a bigger change, please open an issue first so we can talk it through.

1. Fork the project
2. Create your branch (`git checkout -b feature/cool-thing`)
3. Commit your changes (`git commit -m "Add cool thing"`)
4. Push to the branch (`git push origin feature/cool-thing`)
5. Open a pull request

## License

Distributed under the **PolyForm Noncommercial License 1.0.0**. You are free to use, modify, and share this software for noncommercial purposes. See [`LICENSE`](./LICENSE) for details.

## Disclaimer

This is an unofficial fan project. *Doki Doki Literature Club* and its characters belong to Team Salvato. This project is not affiliated with or endorsed by Team Salvato or Google.

---

<div align="center">

Made with love by [kyoyacchi](https://github.com/kyoyacchi)

</div>

<img src="https://upload.wikimedia.org/wikipedia/commons/b/b0/Claude_AI_symbol.svg" alt="Claude" width="16" height="16" /> Written with (mostly) the help of Claude
