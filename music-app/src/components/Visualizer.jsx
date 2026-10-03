import { useRef } from 'react'
import { useVisualizer } from '../hooks/useVisualizer.js'

export function Visualizer({ active }) {
  const ref = useRef(null)
  useVisualizer(ref, active)
  return <canvas id="viz" ref={ref} style={{ display: active ? 'block' : 'none' }} />
}
