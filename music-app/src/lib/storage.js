// localStorage that never throws: private mode and quota errors must not take
// the player down with them.
export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k)
      return v === null ? d : v
    } catch {
      return d
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v)
      return true
    } catch {
      return false
    }
  },
  getJSON(k, d) {
    try {
      const v = JSON.parse(localStorage.getItem(k) || 'null')
      return v === null || v === undefined ? d : v
    } catch {
      return d
    }
  },
  setJSON(k, v) {
    return store.set(k, JSON.stringify(v))
  },
}
