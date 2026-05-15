import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import {
  computeVisible,
  getStoredPersonaId,
  setStoredPersonaId,
} from './personas.js'

// Persona context — exposes the currently picked person, their role,
// and the set of nav-visible page keys to the rest of the app.
//
// State machine:
//   loading → splash (if no persona) → ready
//   ready can flip back to splash via switchPersona(null)

const PersonaContext = createContext({
  status: 'loading', // 'loading' | 'splash' | 'ready'
  persona: null,
  visiblePages: new Set(),
  pickPersona: () => {},
  switchPersona: () => {},
  refreshVisibility: () => {},
})

export function PersonaProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [persona, setPersona] = useState(null)
  const [visiblePages, setVisiblePages] = useState(new Set())

  const loadFromId = useCallback(async (id) => {
    if (!id) {
      setPersona(null)
      setVisiblePages(new Set())
      setStatus('splash')
      return
    }
    // Look up the recipient + their role's settings in parallel.
    const recipientRes = await supabase
      .from('notification_recipients')
      .select('id, name, role, phone, email, active')
      .eq('id', id)
      .maybeSingle()
    if (recipientRes.error || !recipientRes.data || !recipientRes.data.active) {
      // Recipient was deleted / deactivated → kick back to splash so
      // they can pick again instead of getting a broken nav.
      setStoredPersonaId(null)
      setPersona(null)
      setVisiblePages(new Set())
      setStatus('splash')
      return
    }
    const recipient = recipientRes.data
    const roleSettingsRes = await supabase
      .from('role_settings')
      .select('visible_page_keys')
      .eq('role', recipient.role)
      .maybeSingle()
    const keys = roleSettingsRes.data?.visible_page_keys || null
    setPersona(recipient)
    setVisiblePages(computeVisible(recipient.role, keys))
    setStatus('ready')
  }, [])

  useEffect(() => {
    const id = getStoredPersonaId()
    loadFromId(id)
  }, [loadFromId])

  const pickPersona = useCallback(
    async (id) => {
      setStoredPersonaId(id)
      await loadFromId(id)
    },
    [loadFromId],
  )

  const switchPersona = useCallback(() => {
    setStoredPersonaId(null)
    setPersona(null)
    setVisiblePages(new Set())
    setStatus('splash')
  }, [])

  // Called from the Personas admin page when visibility config changes
  // — re-loads visibility for the current persona's role without
  // forcing them to switch out and back in.
  const refreshVisibility = useCallback(async () => {
    if (!persona) return
    const res = await supabase
      .from('role_settings')
      .select('visible_page_keys')
      .eq('role', persona.role)
      .maybeSingle()
    setVisiblePages(computeVisible(persona.role, res.data?.visible_page_keys || null))
  }, [persona])

  return (
    <PersonaContext.Provider
      value={{ status, persona, visiblePages, pickPersona, switchPersona, refreshVisibility }}
    >
      {children}
    </PersonaContext.Provider>
  )
}

export function usePersona() {
  return useContext(PersonaContext)
}
