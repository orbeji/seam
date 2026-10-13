// SPDX-License-Identifier: MIT

import { contextBridge } from 'electron'
import { IPC_CONTRACT_VERSION, type SeamApi } from '../shared/ipc'

const seamApi: SeamApi = {
  contractVersion: IPC_CONTRACT_VERSION
}

contextBridge.exposeInMainWorld('seam', seamApi)
