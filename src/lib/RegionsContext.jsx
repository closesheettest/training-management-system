import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { FL_REGIONS } from './locations.js'

// Single source of truth for the live list of sales regions.
//
// Background: regions used to be a hardcoded FL_REGIONS array. Admin
// can now add / delete regions on the /regions page, and every chip /
// dropdown / map pin in the app reacts immediately. This context loads
// the regions table once at app start, exposes a reload() so the
// admin page can refresh after edits, and falls back to FL_REGIONS as
// the seed list if the DB fetch fails (e.g., migration not run yet —
// the app still renders chips so admin can fix it).
//
// Shape of each region row:
//   { id, name, sort_order, latitude, longitude }
//
// Components consume via useRegions():
//   const { regions, regionNames, reload } = useRegions()
// `regionNames` is a convenience array of just the name strings so
// existing code that did `FL_REGIONS.map(...)` can swap to
// `regionNames.map(...)` with no other changes.

const RegionsContext = createContext({
  regions: [],
  regionNames: [],
  loading: false,
  reload: async () => {},
})

// Build a fallback list from FL_REGIONS so initial paint has something
// to render even before the DB call returns. Lat/lng are null in the
// fallback — RepMap falls back to the corporate office for placement.
function seedFromFallback() {
  return FL_REGIONS.map((name, i) => ({
    id: null,
    name,
    sort_order: (i + 1) * 10,
    latitude: null,
    longitude: null,
  }))
}

export function RegionsProvider({ children }) {
  const [regions, setRegions] = useState(seedFromFallback)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('regions')
      .select('id, name, sort_order, latitude, longitude')
      .order('sort_order', { ascending: true })
    if (!error && Array.isArray(data) && data.length > 0) {
      setRegions(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const value = {
    regions,
    regionNames: regions.map((r) => r.name),
    loading,
    reload,
  }
  return <RegionsContext.Provider value={value}>{children}</RegionsContext.Provider>
}

export function useRegions() {
  return useContext(RegionsContext)
}
