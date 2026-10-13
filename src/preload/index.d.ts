// SPDX-License-Identifier: MIT

import type { SeamApi } from '../shared/ipc'

declare global {
  interface Window {
    seam: SeamApi
  }
}

export {}