import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (body + kanji); the display face is declared in tokens.css from /public/fonts
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/noto-serif-jp/300.css'
import './styles/global.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
