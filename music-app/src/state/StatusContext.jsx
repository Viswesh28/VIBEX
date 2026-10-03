import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const Ctx = createContext(null)
export const useStatus = () => useContext(Ctx)

/**
 * The one-line message under the page title. Kept in its own provider because
 * nearly every feature writes to it, and threading a setter through props
 * would couple the player to the search view for no reason.
 */
export function StatusProvider({ children }) {
  const [status, setStatusState] = useState({
    msg: 'Connecting to JioSaavn API…',
    err: false,
  })

  const setStatus = useCallback((msg, err = false) => {
    setStatusState({ msg, err })
  }, [])

  const value = useMemo(() => ({ status, setStatus }), [status, setStatus])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
