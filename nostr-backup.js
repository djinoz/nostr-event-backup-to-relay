#!/usr/bin/env node

import { SimplePool, nip19 } from 'nostr-tools'
import { program } from 'commander'
import { SocksProxyAgent } from 'socks-proxy-agent'
import WebSocket from 'ws'
import net from 'net'
import { EventEmitter } from 'events'

// Add Node.js TLS options to bypass certificate issues
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0

// Tor proxy configuration
const TOR_PROXY = 'socks5h://127.0.0.1:9050'
const TOR_HOST = '127.0.0.1'
const TOR_PORT = 9050

// Test Tor connectivity
async function testTorConnection() {
  return new Promise((resolve) => {
    console.log('🔍 Testing Tor connectivity...')
    const socket = new net.Socket()
    const timeout = setTimeout(() => {
      socket.destroy()
      console.log('❌ Tor connection test failed: timeout')
      resolve(false)
    }, 5000)
    
    socket.connect(TOR_PORT, TOR_HOST, () => {
      clearTimeout(timeout)
      socket.destroy()
      console.log('✅ Tor connection test passed')
      resolve(true)
    })
    
    socket.on('error', (err) => {
      clearTimeout(timeout)
      console.log(`❌ Tor connection test failed: ${err.message}`)
      resolve(false)
    })
  })
}

// Custom Tor-enabled relay connection for .onion relays
class TorEnabledPool extends SimplePool {
  async querySync(relays, filter) {
    // Check if any relays are .onion addresses
    const onionRelays = relays.filter(relay => relay.includes('.onion'))
    const clearnetRelays = relays.filter(relay => !relay.includes('.onion'))
    
    let allEvents = []
    
    // Handle clearnet relays with normal SimplePool
    if (clearnetRelays.length > 0) {
      try {
        const clearnetEvents = await super.querySync(clearnetRelays, filter)
        allEvents.push(...clearnetEvents)
      } catch (error) {
        console.log(`⚠️  Error querying clearnet relays: ${error.message}`)
      }
    }
    
    // Handle .onion relays with custom WebSocket + Tor proxy
    if (onionRelays.length > 0) {
      const torConnected = await testTorConnection()
      if (!torConnected) {
        console.log('⚠️  Tor not available - skipping .onion relays')
      } else {
        for (const relayUrl of onionRelays) {
          try {
            const onionEvents = await this.queryOnionRelay(relayUrl, filter)
            allEvents.push(...onionEvents)
          } catch (error) {
            console.log(`⚠️  Error querying .onion relay ${relayUrl}: ${error.message}`)
          }
        }
      }
    }
    
    return allEvents
  }
  
  async queryOnionRelay(relayUrl, filter) {
    return new Promise((resolve, reject) => {
      const agent = new SocksProxyAgent(TOR_PROXY)
      const ws = new WebSocket(relayUrl, { agent, rejectUnauthorized: false })
      const events = []
      let isComplete = false
      
      const timeout = setTimeout(() => {
        if (!isComplete) {
          isComplete = true
          ws.close()
          reject(new Error('Timeout querying .onion relay'))
        }
      }, 15000)
      
      ws.on('open', () => {
        console.log(`🧅 Connected to .onion relay: ${relayUrl}`)
        const subId = Math.random().toString(36).substr(2, 9)
        const reqMessage = JSON.stringify(['REQ', subId, filter])
        ws.send(reqMessage)
      })
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          const [type, subId, event] = message
          
          if (type === 'EVENT' && event) {
            events.push(event)
          } else if (type === 'EOSE') {
            if (!isComplete) {
              isComplete = true
              clearTimeout(timeout)
              ws.close()
              console.log(`📥 Retrieved ${events.length} events from ${relayUrl}`)
              resolve(events)
            }
          }
        } catch (error) {
          console.log(`⚠️  Error parsing message from ${relayUrl}: ${error.message}`)
        }
      })
      
      ws.on('error', (error) => {
        if (!isComplete) {
          isComplete = true
          clearTimeout(timeout)
          reject(error)
        }
      })
      
      ws.on('close', () => {
        if (!isComplete) {
          isComplete = true
          clearTimeout(timeout)
          resolve(events)
        }
      })
    })
  }
  
  publish(relays, event) {
    // Check if any relays are .onion addresses
    const onionRelays = relays.filter(relay => relay.includes('.onion'))
    const clearnetRelays = relays.filter(relay => !relay.includes('.onion'))
    
    // Create a custom event emitter for handling both types
    const publisher = new EventEmitter()
    
    let publishCount = 0
    const totalRelays = relays.length
    
    // Handle clearnet relays with parent implementation
    if (clearnetRelays.length > 0) {
      try {
        const clearnetPub = super.publish(clearnetRelays, event)
        if (clearnetPub && typeof clearnetPub.on === 'function') {
          clearnetPub.on('ok', (relay, success, message) => {
            publishCount++
            publisher.emit('ok', relay, success, message)
            if (publishCount >= totalRelays) {
              publisher.emit('complete')
            }
          })
          clearnetPub.on('failed', (relay, message) => {
            publishCount++
            publisher.emit('failed', relay, message)
            if (publishCount >= totalRelays) {
              publisher.emit('complete')
            }
          })
        }
      } catch (error) {
        clearnetRelays.forEach(relay => {
          publishCount++
          publisher.emit('failed', relay, error.message)
          if (publishCount >= totalRelays) {
            publisher.emit('complete')
          }
        })
      }
    }
    
    // Handle .onion relays with custom implementation
    if (onionRelays.length > 0) {
      this.publishToOnionRelays(onionRelays, event, publisher, () => {
        publishCount += onionRelays.length
        if (publishCount >= totalRelays) {
          publisher.emit('complete')
        }
      })
    }
    
    return publisher
  }
  
  async publishToOnionRelays(relays, event, publisher, callback) {
    const torConnected = await testTorConnection()
    if (!torConnected) {
      relays.forEach(relay => {
        publisher.emit('failed', relay, 'Tor not available')
      })
      callback()
      return
    }
    
    const publishPromises = relays.map(relayUrl => 
      this.publishToOnionRelay(relayUrl, event, publisher)
    )
    
    await Promise.allSettled(publishPromises)
    callback()
  }
  
  async publishToOnionRelay(relayUrl, event, publisher) {
    return new Promise((resolve) => {
      const agent = new SocksProxyAgent(TOR_PROXY)
      const ws = new WebSocket(relayUrl, { agent, rejectUnauthorized: false })
      let isComplete = false
      
      const timeout = setTimeout(() => {
        if (!isComplete) {
          isComplete = true
          ws.close()
          publisher.emit('failed', relayUrl, 'Timeout publishing to .onion relay')
          resolve()
        }
      }, 15000)
      
      ws.on('open', () => {
        console.log(`🧅 Publishing to .onion relay: ${relayUrl}`)
        const eventMessage = JSON.stringify(['EVENT', event])
        ws.send(eventMessage)
      })
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          const [type, eventId, success, reason] = message
          
          if (type === 'OK') {
            if (!isComplete) {
              isComplete = true
              clearTimeout(timeout)
              ws.close()
              publisher.emit('ok', relayUrl, success, reason || '')
              resolve()
            }
          }
        } catch (error) {
          console.log(`⚠️  Error parsing response from ${relayUrl}: ${error.message}`)
        }
      })
      
      ws.on('error', (error) => {
        if (!isComplete) {
          isComplete = true
          clearTimeout(timeout)
          publisher.emit('failed', relayUrl, error.message)
          resolve()
        }
      })
      
      ws.on('close', () => {
        if (!isComplete) {
          isComplete = true
          clearTimeout(timeout)
          publisher.emit('failed', relayUrl, 'Connection closed without response')
          resolve()
        }
      })
    })
  }
}

// Parse command line arguments
program
  .name('nostr-backup')
  .description('Backup nostr events from source relays to target relay')
  .requiredOption('-n, --npub <npub>', 'npub/hex pubkey to backup events for')
  .requiredOption('-t, --target <relay>', 'target relay to backup events to')
  .option('-r, --relay <relays...>', 'source relays to fetch from', [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://nostr.mom',
    'wss://relay.primal.net'
  ])
  .option('-k, --kinds <kinds...>', 'event kinds to backup (comma-separated)', '1,6,7')
  .option('--since <timestamp>', 'only fetch events since this unix timestamp')
  .option('--until <timestamp>', 'only fetch events until this unix timestamp')
  .option('--days <days>', 'only fetch events from last N days', '30')
  .option('--batch-size <size>', 'batch size for publishing', '10')
  .option('--delay <ms>', 'delay between batches in milliseconds', '1000')
  .option('--dry-run', 'show what would be done without actually publishing')
  .parse()

const options = program.opts()

// Parse npub to hex if needed
let pubkey
try {
  if (options.npub.startsWith('npub')) {
    const decoded = nip19.decode(options.npub)
    pubkey = decoded.data
  } else if (options.npub.match(/^[0-9a-f]{64}$/)) {
    pubkey = options.npub
  } else {
    throw new Error('Invalid pubkey format')
  }
} catch (error) {
  console.error('Error: Invalid npub/pubkey format')
  process.exit(1)
}

// Parse kinds - handle both string and array inputs
console.log('Debug - options.kinds:', options.kinds, 'type:', typeof options.kinds)

let kinds
if (Array.isArray(options.kinds)) {
  console.log('Debug - treating as array')
  // Multiple -k flags: [30078, 30023]
  kinds = options.kinds.flatMap(k => {
    console.log('Debug - processing array element:', k, 'type:', typeof k)
    if (typeof k === 'string' && k.includes(',')) {
      const split = k.split(',').map(n => parseInt(n.trim()))
      console.log('Debug - split result:', split)
      return split
    }
    return [parseInt(k)]
  })
} else if (typeof options.kinds === 'string') {
  console.log('Debug - treating as string')
  // Single -k flag with comma-separated: "30078,30023"
  kinds = options.kinds.split(',').map(k => parseInt(k.trim()))
} else {
  console.log('Debug - treating as number')
  // Single -k flag with single number: 30078
  kinds = [parseInt(options.kinds)]
}

console.log('Debug - final kinds array:', kinds)

// Calculate time window
let since, until
if (options.since) {
  since = parseInt(options.since)
}
if (options.until) {
  until = parseInt(options.until)
}
if (options.days && !since) {
  since = Math.floor(Date.now() / 1000) - (parseInt(options.days) * 24 * 60 * 60)
}

// Setup relays (automatically add target to source list)
const sourceRelays = [...new Set([...options.relay, options.target])]
const targetRelay = options.target

console.log(`🔍 Fetching events for: ${options.npub}`)
console.log(`📡 Source relays: ${sourceRelays.join(', ')}`)
console.log(`🎯 Target relay: ${targetRelay}`)
console.log(`📝 Event kinds: ${kinds.join(', ')}`)
if (since) console.log(`📅 Since: ${new Date(since * 1000).toISOString()}`)
if (until) console.log(`📅 Until: ${new Date(until * 1000).toISOString()}`)
console.log(`📦 Batch size: ${options.batchSize}`)
console.log('---')

const pool = new TorEnabledPool()

// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.log(`⚠️  Unhandled promise rejection: ${reason}`)
  // Don't exit, just log it
})

process.on('uncaughtException', (error) => {
  console.log(`💥 Uncaught exception: ${error.message}`)
  process.exit(1)
})

async function main() {
  try {
    // Build filter
    const filter = {
      authors: [pubkey],
      kinds: kinds
    }
    if (since) filter.since = since
    if (until) filter.until = until

    console.log('🔄 Fetching existing events from target relay...')
    
    // Get existing events from target relay to avoid duplicates
    const existingEvents = new Set()
    
    try {
      console.log(`🔗 Attempting to connect to target relay: ${targetRelay}`)
      const existingEventsArray = await pool.querySync([targetRelay], filter)
      console.log(`📡 Successfully connected to target relay`)
      existingEventsArray.forEach(event => {
        existingEvents.add(event.id)
      })
    } catch (error) {
      console.log(`❌ Could not connect to target relay: ${error.message}`)
      console.log(`🔍 This might be a certificate issue with your Start9 relay`)
      
      // Ask user if they want to continue
      console.log(`\n⚠️  WARNING: Cannot connect to target relay!`)
      console.log(`   This means events will be published but we can't verify they're received.`)
      console.log(`   The script will continue, but check your relay manually afterwards.`)
    }
    
    console.log(`✅ Found ${existingEvents.size} existing events on target relay`)

    console.log('🔄 Fetching events from source relays...')
    
    // Debug: show the filter being used
    console.log(`🔍 Filter: ${JSON.stringify(filter)}`)
    
    // Fetch events from source relays
    const events = await pool.querySync(sourceRelays, filter)
    
    // Debug: show breakdown by kind
    const eventsByKind = {}
    events.forEach(event => {
      eventsByKind[event.kind] = (eventsByKind[event.kind] || 0) + 1
    })
    console.log(`📊 Events by kind: ${JSON.stringify(eventsByKind)}`)
    
    console.log(`📥 Retrieved ${events.length} total events from source relays`)

    // Filter out duplicates and events already on target
    const newEvents = events.filter(event => !existingEvents.has(event.id))
    
    // Sort by created_at (oldest first for better chronological order)
    newEvents.sort((a, b) => a.created_at - b.created_at)
    
    console.log(`🆕 Found ${newEvents.length} new events to backup`)

    if (newEvents.length === 0) {
      console.log('✅ No new events to backup!')
      return
    }

    if (options.dryRun) {
      console.log('\n🔍 DRY RUN - Events that would be published:')
      newEvents.forEach((event, i) => {
        const date = new Date(event.created_at * 1000).toISOString()
        const preview = event.content.slice(0, 50).replace(/\n/g, ' ')
        console.log(`${i + 1}. [${date}] Kind ${event.kind}: ${preview}${event.content.length > 50 ? '...' : ''}`)
      })
      console.log(`\n📊 Total: ${newEvents.length} events would be published`)
      return
    }

    // Publish in batches
    const batchSize = parseInt(options.batchSize)
    const delay = parseInt(options.delay)
    let published = 0
    let failed = 0

    for (let i = 0; i < newEvents.length; i += batchSize) {
      const batch = newEvents.slice(i, i + batchSize)
      console.log(`📤 Publishing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(newEvents.length / batchSize)} (${batch.length} events)...`)
      
      const promises = batch.map(async (event) => {
        return new Promise((resolve) => {
          try {
            const pub = pool.publish([targetRelay], event)
            
            let resolved = false
            const timeout = setTimeout(() => {
              if (!resolved) {
                resolved = true
                resolve({ success: false, event, error: new Error('Timeout - no response from relay') })
              }
            }, 8000)
            
            // Handle the publisher object properly
            if (pub && typeof pub.on === 'function') {
              // It's an event emitter
              pub.on('ok', (relay, success, message) => {
                if (!resolved) {
                  resolved = true
                  clearTimeout(timeout)
                  if (success) {
                    resolve({ success: true, event, relay })
                  } else {
                    resolve({ success: false, event, error: new Error(message || 'Relay rejected event') })
                  }
                }
              })
              
              pub.on('failed', (relay, message) => {
                if (!resolved) {
                  resolved = true
                  clearTimeout(timeout)
                  resolve({ success: false, event, error: new Error(message || 'Publish failed') })
                }
              })
              
              // Catch any uncaught errors on the publisher
              pub.on('error', (error) => {
                if (!resolved) {
                  resolved = true
                  clearTimeout(timeout)
                  resolve({ success: false, event, error })
                }
              })
            } else {
              // Fallback - assume it worked if no event emitter interface
              clearTimeout(timeout)
              resolved = true
              resolve({ success: true, event })
            }
          } catch (error) {
            resolve({ success: false, event, error })
          }
        })
      })

      try {
        const results = await Promise.allSettled(promises)
        
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            if (result.value.success) {
              published++
              console.log(`  ✅ Published: ${result.value.event.id.slice(0, 8)}...`)
            } else {
              failed++
              console.log(`  ❌ Failed: ${result.value.event.id.slice(0, 8)}... (${result.value.error.message})`)
            }
          } else {
            failed++
            console.log(`  ❌ Promise rejected: ${result.reason}`)
          }
        })
      } catch (batchError) {
        console.log(`  💥 Batch error: ${batchError.message}`)
        failed += batch.length
      }

      // Delay between batches (except for last batch)
      if (i + batchSize < newEvents.length) {
        console.log(`⏳ Waiting ${delay}ms before next batch...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    console.log('\n📊 Summary:')
    console.log(`✅ Successfully published: ${published} events`)
    console.log(`❌ Failed: ${failed} events`)
    console.log(`📈 Success rate: ${((published / (published + failed)) * 100).toFixed(1)}%`)

  } catch (error) {
    console.error('💥 Error:', error.message)
    process.exit(1)
  } finally {
    // Add a small delay before closing connections to let any pending operations finish
    console.log('🔌 Closing relay connections...')
    await new Promise(resolve => setTimeout(resolve, 2000))
    pool.close(sourceRelays.concat([targetRelay]))
  }
}

main().catch(console.error)
