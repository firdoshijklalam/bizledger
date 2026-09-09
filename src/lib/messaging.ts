// §MESSAGING-LIB: Shared constants + types for the unified messaging system.
// Exported so API routes + UI + tests can import the same validation lists.

export const MESSAGE_CHANNELS = [
  'whatsapp', 'telegram', 'messenger', 'instagram', 'sms', 'email', 'in_app',
] as const
export type MessageChannel = typeof MESSAGE_CHANNELS[number]

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound', 'internal_note'] as const
export type MessageDirection = typeof MESSAGE_DIRECTIONS[number]

export const MESSAGE_SENDER_TYPES = ['customer', 'staff', 'system', 'bot'] as const
export type MessageSenderType = typeof MESSAGE_SENDER_TYPES[number]

// §CHANNEL-META: visual config for the UI. Each channel has an icon name +
// color + whether external integration is available (future) or in_app only.
export const CHANNEL_META: Record<string, { label: string; icon: string; color: string; externalAvailable: boolean }> = {
  whatsapp: { label: 'WhatsApp', icon: 'MessageCircle', color: 'text-green-600 bg-green-100 dark:bg-green-950/40', externalAvailable: false },
  telegram: { label: 'Telegram', icon: 'Send', color: 'text-blue-600 bg-blue-100 dark:bg-blue-950/40', externalAvailable: false },
  messenger: { label: 'Messenger', icon: 'MessageCircle', color: 'text-blue-500 bg-blue-100 dark:bg-blue-950/40', externalAvailable: false },
  instagram: { label: 'Instagram', icon: 'Instagram', color: 'text-pink-600 bg-pink-100 dark:bg-pink-950/40', externalAvailable: false },
  sms: { label: 'SMS', icon: 'Smartphone', color: 'text-violet-600 bg-violet-100 dark:bg-violet-950/40', externalAvailable: false },
  email: { label: 'Email', icon: 'Mail', color: 'text-amber-600 bg-amber-100 dark:bg-amber-950/40', externalAvailable: false },
  in_app: { label: 'In-App', icon: 'MessageSquare', color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/40', externalAvailable: true },
}

// §VALIDATE-CHANNEL: checks if a string is a valid channel
export function isValidChannel(channel: string): boolean {
  return MESSAGE_CHANNELS.includes(channel as MessageChannel)
}

// §VALIDATE-DIRECTION: checks if a string is a valid direction
export function isValidDirection(direction: string): boolean {
  return MESSAGE_DIRECTIONS.includes(direction as MessageDirection)
}

// §VALIDATE-SENDER-TYPE: checks if a string is a valid sender type
export function isValidSenderType(senderType: string): boolean {
  return MESSAGE_SENDER_TYPES.includes(senderType as MessageSenderType)
}

// §EXTERNAL-AVAILABLE: whether a channel has external provider integration
// (currently only in_app is available; external channels are future)
export function isExternalChannelAvailable(channel: string): boolean {
  const meta = CHANNEL_META[channel]
  return meta?.externalAvailable ?? false
}
