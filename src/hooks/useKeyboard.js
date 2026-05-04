import { useEffect, useRef } from 'react'

export function useKeyboard() {
  const keys = useRef({})

  useEffect(() => {
    const onKeyDown = (e) => {
      keys.current[e.code] = true
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault()
      }
    }
    const onKeyUp = (e) => {
      keys.current[e.code] = false
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return keys
}
