import { useState } from 'react'
import { EQ_BANDS, EQ_PRESETS } from '../lib/audioDsp.js'
import { Icon } from './Icon.jsx'
import { useSettings } from '../state/SettingsContext.jsx'
import { useStatus } from '../state/StatusContext.jsx'
import { useUI } from '../state/UIContext.jsx'

export function DspControls() {
  const { dsp, updateDsp, setEqPreset, setEqBand, customEqPresets, saveCustomEqPreset } = useSettings()
  const { setStatus } = useStatus()
  const [presetName, setPresetName] = useState('')

  const allPresets = [
    ...Object.entries(EQ_PRESETS),
    ...Object.entries(customEqPresets || {}),
  ]

  const handleSaveCustom = () => {
    const key = saveCustomEqPreset(presetName)
    if (key) {
      setStatus(`Saved EQ preset “${presetName.trim()}”.`)
      setPresetName('')
    }
  }

  return (
    <div className="dsp-panel">
      <div className="dsp-quick-row">
        <button
          type="button"
          className={'chip dsp-pill' + (dsp.slowedReverb ? ' active' : '')}
          aria-pressed={!!dsp.slowedReverb}
          onClick={() => updateDsp({ slowedReverb: !dsp.slowedReverb })}
        >
          <Icon name="sparkle" size={14} />
          Slowed + Reverb
        </button>

        <button
          type="button"
          className={'chip dsp-pill' + (dsp.loudnessNorm ? ' active' : '')}
          aria-pressed={!!dsp.loudnessNorm}
          onClick={() => updateDsp({ loudnessNorm: !dsp.loudnessNorm })}
        >
          <Icon name="volume" size={14} />
          Loudness Normalize
        </button>

        <button
          type="button"
          className={'chip dsp-pill' + (dsp.eqOn ? ' active' : '')}
          aria-pressed={!!dsp.eqOn}
          onClick={() => updateDsp({ eqOn: !dsp.eqOn })}
        >
          <Icon name="sliders" size={14} />
          {dsp.eqOn ? '10-Band EQ: On' : '10-Band EQ: Bypass'}
        </button>
      </div>

      <div className="dsp-presets" role="group" aria-label="Equalizer presets">
        {allPresets.map(([key, p]) => (
          <button
            key={key}
            type="button"
            className={'chip' + (dsp.eqPreset === key ? ' active' : '')}
            onClick={() => setEqPreset(key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="eq-grid" role="group" aria-label="10-band equalizer sliders">
        {EQ_BANDS.map((band, idx) => {
          const val = Number(dsp.eqGains?.[idx]) || 0
          return (
            <div key={band.freq} className="eq-band">
              <span className="eq-val">{val > 0 ? `+${val}` : val}</span>
              <input
                type="range"
                className="eq-slider"
                min="-12"
                max="12"
                step="0.5"
                value={val}
                aria-label={`${band.label} Hz gain`}
                onChange={(e) => setEqBand(idx, Number(e.target.value))}
              />
              <span className="eq-freq">{band.label}</span>
            </div>
          )
        })}
      </div>

      <div className="dsp-sliders-grid">
        <label className="dsp-ctrl-row">
          <span>
            Speed: <b>{(dsp.slowedReverb ? 0.84 : dsp.playbackRate || 1).toFixed(2)}x</b>
          </span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.02"
            disabled={dsp.slowedReverb}
            value={dsp.slowedReverb ? 0.84 : dsp.playbackRate || 1}
            aria-label="Playback speed"
            onChange={(e) => updateDsp({ playbackRate: Number(e.target.value) })}
          />
        </label>

        <label className="dsp-ctrl-row">
          <span>
            Hall Reverb: <b>{Math.round((dsp.slowedReverb ? 0.38 : dsp.reverbMix || 0) * 100)}%</b>
          </span>
          <input
            type="range"
            min="0"
            max="0.75"
            step="0.05"
            disabled={dsp.slowedReverb}
            value={dsp.slowedReverb ? 0.38 : dsp.reverbMix || 0}
            aria-label="Hall reverb wet mix"
            onChange={(e) => updateDsp({ reverbMix: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="dsp-bottom-row">
        <label className="switch-row" style={{ margin: 0, gap: 10 }}>
          <span>Lock pitch when changing speed</span>
          <span>
            <input
              type="checkbox"
              aria-label="Lock pitch when changing speed"
              checked={dsp.preservePitch !== false}
              disabled={dsp.slowedReverb}
              onChange={(e) => updateDsp({ preservePitch: e.target.checked })}
            />
            <span className="switch" />
          </span>
        </label>

        <div className="dsp-save-preset">
          <input
            type="text"
            aria-label="Custom preset name"
            placeholder="Save custom preset…"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveCustom()
            }}
          />
          <button
            type="button"
            className="btn-ghost"
            disabled={!presetName.trim()}
            onClick={handleSaveCustom}
          >
            Save
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              updateDsp({
                eqOn: false,
                eqPreset: 'flat',
                eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                loudnessNorm: false,
                playbackRate: 1,
                preservePitch: true,
                reverbMix: 0,
                slowedReverb: false,
              })
              setStatus('Audio DSP reset to flat studio bypass.')
            }}
          >
            Reset all
          </button>
        </div>
      </div>
    </div>
  )
}

export function DspRackModal() {
  const { dspOpen, setDspOpen } = useUI()
  if (!dspOpen) return null

  return (
    <div id="plModal" className="open" onClick={() => setDspOpen(false)}>
      <div
        className="modal-card dsp-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Studio Audio Equalizer and DSP"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head-row">
          <h3>
            <Icon name="sliders" size={18} /> Studio EQ &amp; Audio FX
          </h3>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close Studio EQ"
            onClick={() => setDspOpen(false)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <DspControls />
      </div>
    </div>
  )
}
