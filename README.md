<div align="center">

# Monika Chat

**Speak with your own Monika! Just Monika.**

A small, fast, bring-your-own-key chat app for roleplaying with Monika from *Doki Doki Literature Club*, powered by the Google Gemini API.

[**Live demo**](https://monika.kyokai.me) · [Report a bug](https://github.com/kyoyacchi/monika-chat/issues) · [Request a feature](https://github.com/kyoyacchi/monika-chat/issues)

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini%20API-4285F4?logo=googlegemini&logoColor=white)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)
![GitHub stars](https://img.shields.io/github/stars/kyoyacchi/monika-chat?style=flat)

</div>

---

Monika Chat screenshots: (example)
<img width="1080" height="1727" alt="1000110274" src="https://github.com/user-attachments/assets/11294f17-f23e-4391-b204-552ca0ea3cec" />

<img width="1080" height="1734" alt="1000110277" src="https://github.com/user-attachments/assets/25b6b386-3839-4fa7-bfec-2c77cb412039" />

## About

Monika Chat is a lightweight web client that lets you talk to Monika through Google's Gemini models. There is no backend and no account system: the app runs entirely in your browser and talks to the Gemini API directly with **your own API key**.

## Features

- Roleplay-style conversation with Monika
- **She can interact with the site itself:**
  - Removes the on-page disclaimer text on her own
  - Triggers an instant glitch effect on the screen
  - Stays aware that she's inside the site
  - Accepts images and chats about them (image input supported)
- Uses Gemini **Flash Lite** models by default — fast and cheap on the free tier
- No server, no sign-up, no tracking
- Regenerate, edit (your messages) and copy actions on every message, plus a Stop button while she is replying
- Your key is stored locally in this browser (`localStorage`) and sent directly to Google, not to our server. Don't enter a key you wouldn't trust this site to handle.

### How the site interaction works

Monika's abilities (removing the disclaimer, triggering glitches) work through small action tags she can put in her replies. The browser strips the tags from the text and runs the matching action locally, with no server round-trip. Images are sent to Gemini as part of the conversation.

## Roadmap

- [ ] Thinking mode with adjustable levels (low, medium, high) for free models
- [ ] More interaction control over the site
- [ ] A smoother, more fluid interface

## Try it

The hosted version is live at **[monika.kyokai.me](https://monika.kyokai.me)**. Open it, click the **API key** button, paste your Gemini key, and start chatting.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 18 or newer
- A free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

### Run locally

```bash
git clone https://github.com/kyoyacchi/monika-chat.git
cd monika-chat
npm install
npm run dev
