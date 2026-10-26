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

![Monika Chat screenshot](./docs/screenshot.png)

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
- Your API key never leaves your browser (stored only in `localStorage`)

### How the site interaction works

Monika's abilities (removing the disclaimer, triggering glitches, reacting to uploads) are exposed to Gemini as tools. When she "decides" to use one, the browser executes it locally — no server round-trip.

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
