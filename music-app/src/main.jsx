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
import { store } from './lib/storage.js'
import { initInstallPrompt } from './lib/install.js'
import { registerServiceWorker } from './lib/pwa.js'
import { applyPlatformClasses, preparePlaybackAudioSession, setThemeColor } from './lib/platform.js'
import { createSupabaseSyncService } from './lib/supabaseSync.js'

applyPlatformClasses()
const bootTheme = store.get('svTheme', 'dark') === 'light' ? 'light' : 'dark'
document.documentElement.classList.toggle('light', bootTheme === 'light')
document.body.classList.toggle('light', bootTheme === 'light')
document.documentElement.style.removeProperty('--vibex-boot-bg')
setThemeColor(bootTheme === 'light' ? '#f7f7f9' : '#09090b')
preparePlaybackAudioSession()
initInstallPrompt()
registerServiceWorker()

const cloudAccountProvider = createSupabaseSyncService()

// Provider order matters: Player reads Settings, Library and Status.
const tree = (
  <React.StrictMode>
    <StatusProvider>
      <SettingsProvider>
        <LibraryProvider accountProvider={cloudAccountProvider}>
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

installNativeHttp()
  .catch(() => {})
  .then(() => createRoot(document.getElementById('root')).render(tree))
