// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react'
import type { BranchOrderPreference } from '../../shared/ipc'
import { SETTINGS_CHANGED } from '../settings-events'

/**
 * The order every branch list uses, read from the stored preferences and kept
 * in step when the settings dialog changes it.
 */
export function useBranchOrder(): BranchOrderPreference {
  const [order, setOrder] = useState<BranchOrderPreference>('ascending')

  useEffect(() => {
    let active = true
    const read = (): void => {
      void window.seam.readSettings().then((result) => {
        if (active && result.ok) setOrder(result.value.branchOrder)
      })
    }
    read()
    window.addEventListener(SETTINGS_CHANGED, read)
    return () => {
      active = false
      window.removeEventListener(SETTINGS_CHANGED, read)
    }
  }, [])

  return order
}
