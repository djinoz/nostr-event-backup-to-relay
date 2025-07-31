# Nostr Event Backup to Relay

A Node.js command-line tool for backing up your Nostr events from multiple source relays to your personal relay. Perfect for creating personal backups on your own relay (like Start9, BTCPay Server, or other self-hosted solutions).

## Features

- ✅ **Automatic duplicate detection** - Skips events already on your target relay
- ✅ **Multiple source relays** - Fetches from 5 major relays by default  
- ✅ **Time window filtering** - Backup specific date ranges or recent events
- ✅ **Custom event kinds** - Choose which types of events to backup
- ✅ **Batch processing** - Rate-limited publishing to avoid overwhelming relays
- ✅ **Dry run mode** - Preview what would be backed up without publishing
- ✅ **Certificate bypass** - Works with self-signed certificates (Start9, etc.)
- ✅ **Progress reporting** - Real-time feedback on backup progress
- ✅ **Tor/.onion support** - Full support for .onion relays via Tor network

## Installation

```bash
git clone https://github.com/djinoz/nostr-event-backup-to-relay
cd nostr-event-backup-to-relay
npm install
chmod +x nostr-backup.js
```

### For .onion Relay Support

To use .onion relays, you need Tor running locally:

```bash
# Install Tor (macOS)
brew install tor

# Start Tor service
brew services start tor

# Verify Tor is running on port 9050
lsof -i :9050
```

## Quick Start

**Basic backup (last 30 days):**
```bash
./nostr-backup.js -n YOUR_NPUB -t wss://your-relay.com
```

**Dry run to see what would be backed up:**
```bash
./nostr-backup.js -n YOUR_NPUB -t wss://your-relay.com --dry-run
```

## Usage

```bash
./nostr-backup.js [options]
```

### Required Options

- `-n, --npub <npub>` - Your npub or hex pubkey to backup events for
- `-t, --target <relay>` - Target relay URL to backup events to

### Optional Options

- `-r, --relay <relays...>` - Source relays to fetch from (defaults to 5 major relays)
- `-k, --kinds <kinds>` - Event kinds to backup (default: "1,6,7" = notes, reposts, reactions)
- `--since <timestamp>` - Only fetch events since this unix timestamp
- `--until <timestamp>` - Only fetch events until this unix timestamp  
- `--days <days>` - Only fetch events from last N days (default: 30)
- `--batch-size <size>` - Batch size for publishing (default: 10)
- `--delay <ms>` - Delay between batches in milliseconds (default: 1000)
- `--dry-run` - Show what would be backed up without actually publishing

## Examples

**Backup last 7 days:**
```bash
./nostr-backup.js -n npub1... -t wss://my-relay.com --days 7
```

**Specific time range:**
```bash
./nostr-backup.js -n npub1... -t wss://my-relay.com --since 1704067200 --until 1706745600
```

**Custom event kinds (notes, long-form, zaps):**
```bash
./nostr-backup.js -n npub1... -t wss://my-relay.com -k "1,30023,9735"
```

**Different source relays:**
```bash
./nostr-backup.js -n npub1... -t wss://my-relay.com \
  -r wss://relay.damus.io wss://nos.lol wss://relay.snort.social
```

**Conservative settings for slow/unstable connections:**
```bash
./nostr-backup.js -n npub1... -t wss://my-relay.com \
  --batch-size 3 --delay 5000 --days 7
```

**Full year backup:**
```bash
./nostr-backup.js -n npub1... -t wss://my-relay.com \
  --days 365 --batch-size 5 --delay 2000
```

**Backup to .onion relay:**
```bash
./nostr-backup.js -n npub1... -t ws://your-relay.onion --days 30
```

**Mix of clearnet and .onion source relays:**
```bash
./nostr-backup.js -n npub1... -t ws://your-relay.onion \
  -r wss://relay.damus.io ws://some-relay.onion wss://nos.lol
```

## Default Source Relays

The tool uses these reliable relays by default:
- `wss://relay.damus.io` - Popular and reliable
- `wss://nos.lol` - Fast and well-maintained  
- `wss://relay.nostr.band` - Great for discovery
- `wss://nostr.mom` - Stable community relay
- `wss://relay.primal.net` - High-performance relay

These were the ones I knew I has been saving notes to by using another tool I vibed: https://github.com/djinoz/nostr-event-is-where.

Your target relay is automatically added to this list to check for existing events.

## Event Kinds Reference

Common event kinds you might want to backup:
- `1` - Text notes (posts)
- `3` - Contact list (following)
- `6` - Reposts
- `7` - Reactions (likes)
- `9735` - Zaps
- `30023` - Long-form articles
- `0` - Profile metadata

You can choose the kinds to fetch by using another tool I vibed: https://github.com/djinoz/nostr-kind-explorer

## Working with Start9 and Self-Hosted Relays

This tool is designed to work with self-hosted relays that may use self-signed certificates:

- **Start9 Embassy relays** - Automatically bypasses certificate validation
- **BTCPay Server relays** - Works with local .local domains
- **Umbrel relays** - Handles non-standard certificates
- **Other self-hosted solutions** - Sets `NODE_TLS_REJECT_UNAUTHORIZED=0`

## Working with .onion Relays

The tool has full Tor integration for privacy-focused backups:

- **Automatic Tor detection** - Tests connectivity to Tor SOCKS5 proxy (127.0.0.1:9050)
- **Mixed relay support** - Can query both clearnet and .onion relays simultaneously  
- **Smart routing** - Automatically routes .onion addresses through Tor proxy
- **Graceful fallback** - Continues with clearnet relays if Tor unavailable
- **Target and source support** - Works for both backup destination and source relays

**Note:** .onion relays typically use `ws://` (not `wss://`) protocol.

## Troubleshooting

**Certificate errors with self-hosted relays:**
- The tool automatically bypasses certificate validation
- Make sure you're on the same network as your relay for .local domains

**"Found 0 existing events" but relay has events:**
- Check that you're on the correct network for .local relays
- Verify the relay URL is correct
- Your relay might not support the filter types being used

**Network timeouts or "non-101 status code" errors:**
- Reduce batch size: `--batch-size 3`
- Increase delay: `--delay 3000`
- Try fewer days: `--days 7`
- Check your relay's connection stability

**No events found:**
- Verify your npub/pubkey is correct
- Try increasing the time window: `--days 90`
- Check if your events are on the default source relays

**.onion relay connection issues:**
- Ensure Tor is running: `brew services start tor`
- Test Tor connectivity: `curl --socks5 127.0.0.1:9050 https://check.torproject.org`
- Verify .onion relay URL is correct and active
- Try with `--dry-run` first to test connectivity

## Technical Details

- **Built with:** Node.js + nostr-tools + socks-proxy-agent + ws
- **Certificate handling:** Bypasses validation for self-signed certificates  
- **Tor integration:** SOCKS5 proxy support with automatic .onion detection
- **Duplicate detection:** Uses event IDs to avoid republishing existing events
- **Rate limiting:** Configurable batch processing with delays
- **Error handling:** Graceful handling of network issues and relay rejections
- **Mixed relay support:** Simultaneously queries clearnet and .onion relays

## Contributing

Issues and pull requests welcome! This tool was built to solve the practical problem of backing up Nostr events to personal relays.

## License

MIT License

## Acknowledgments

- Built with [nostr-tools](https://github.com/nbd-wtf/nostr-tools)
- Tor/.onion integration adapted from [simple-nostr-over-tor](https://github.com/djinoz/simple-nostr-over-tor)
- Inspired by the need for personal Nostr event backups
- Designed for the self-hosting community
