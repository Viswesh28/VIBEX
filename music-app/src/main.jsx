import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { LibraryProvider } from './state/LibraryContext.jsx'
import { PlayerProvider } from './state/PlayerContext.jsx'
import { SettingsProvider } from './state/SettingsContext.jsx'
import { StatusProvider } from './state/StatusContext.jsx'
import { UIProvider } from './state/UIContext.jsx'
import './styles/global.css'

// Provider order matters: Player reads Settings, Library and Status.
createRoot(document.getElementById('root')).render(
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
