import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { playClickSound } from './utils/sound.js'

// App-wide click sound for every button/clickable interaction — menus,
// setup screens, modals, etc. Registered once here rather than wired
// into each component individually. Uses the capture phase so it fires
// before any component's own onClick can stopPropagation() (several
// modals do this on their card wrapper to stop backdrop-close clicks).
// The Submit button is excluded since it plays its own bell sound instead.
document.addEventListener('click', (e) => {
  const target = e.target.closest('button, [role="button"]');
  if (!target || target.disabled || target.closest('.submit-button')) return;
  playClickSound();
}, true);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
