/**
 * Chunked RPC — send large payloads over WebSocket in small pieces.
 *
 * Splits a single large RPC argument into base64 chunks (~512KB each),
 * sends them via the transfer:start/chunk/commit protocol, and the
 * remote server reassembles and executes the original RPC handler.
 */

import type { WsRpcClient } from '../transport/client'

/** 384KB raw → ~512KB after base64 encoding. Well under proxy frame limits. */
const CHUNK_SIZE = 384 * 1024

/** Threshold above which we switch from direct RPC to chunked transfer. */
export const CHUNKED_TRANSFER_THRESHOLD = 5 * 1024 * 1024  // 5MB

/**
 * Send a large RPC call in chunks over the existing WebSocket connection.
 *
 * @param client      Connected WsRpcClient to the remote server
 * @param channel     The original RPC channel (e.g. 'sessions:import')
 * @param args        The original arguments array
 * @param largeArgIndex  Which argument is the large payload (will be chunked)
 * @returns           The result from the remote handler (same as a direct invoke)
 */
export async function invokeChunked(
  client: WsRpcClient,
  channel: string,
  args: any[],
  largeArgIndex: number,
): Promise<any> {
  // 1. Serialize the large argument to JSON, then to raw bytes
  const json = JSON.stringify(args[largeArgIndex])
  const bytes = Buffer.from(json, 'utf-8')

  // 2. Split into base64 chunks
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(bytes.subarray(i, i + CHUNK_SIZE).toString('base64'))
  }

  // 3. Build deferred args (replace large arg with null placeholder)
  const deferredArgs = [...args]
  deferredArgs[largeArgIndex] = null

  // 4. Start transfer
  console.log(`[ChunkedRPC] Starting transfer: ${chunks.length} chunks, ${bytes.length} bytes, channel: ${channel}`)
  const { transferId } = await client.invoke('transfer:start', {
    totalBytes: bytes.length,
    chunkCount: chunks.length,
    channel,
    args: deferredArgs,
    largeArgIndex,
  }) as { transferId: string }
  console.log(`[ChunkedRPC] Transfer started: ${transferId}`)

  // 5. Send chunks sequentially
  for (let i = 0; i < chunks.length; i++) {
    await client.invoke('transfer:chunk', {
      transferId,
      index: i,
      data: chunks[i],
    })
    if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
      console.log(`[ChunkedRPC] Sent chunk ${i + 1}/${chunks.length}`)
    }
  }

  // 6. Commit — returns the result of the original RPC call
  console.log(`[ChunkedRPC] All chunks sent, committing...`)
  const result = await client.invoke('transfer:commit', { transferId })
  console.log(`[ChunkedRPC] Transfer committed successfully`)
  return result
}
