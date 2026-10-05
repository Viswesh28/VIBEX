import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { LibraryProvider } from './state/LibraryContext.jsx'
import { PlayerProvider } from './state/PlayerContext.jsx'
import { SettingsProvider } from './state/SettingsContext.jsx'
import { StatusProvider } from './state/StatusContext.jsx'
import { UIProvider } from './state/UIContext.jsx'
import './styles/global.css'
import { installNativeHttp } from './lib/http.js'

// Provider order matters: Player reads Settings, Library and Status.
const tree = (
  <React.StrictMode>
    <StatusProvider>
      <SettingsProvider>
        <LibraryProvider>
          <PlayerProvider>
            <UIProvider>
              <App />
            </UIProvider>
          </PlayerProvider>
        </LibraryProvider>
      </SettingsProvider>
    </StatusProvider>
  </React.StrictMode>
)

// Route JioSaavn calls through the native HTTP stack *before* anything can
// fetch — the home feed fires as soon as App mounts. Resolves immediately and
// does nothing in a browser, and a failure here must not block the UI.
installNativeHttp()
  .catch(() => {})
  .then(() => createRoot(document.getElementById('root')).render(tree))
