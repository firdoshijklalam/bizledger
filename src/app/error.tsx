'use client'

/**
 * Route-level Error Boundary.
 * Catches errors thrown during render of the page tree and lets the user
 * recover without a full page reload.
 */
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[RouteError]', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 40 }}>⚠️</div>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>
        Couldn&apos;t load this screen
      </h2>
      <p style={{ fontSize: 13, color: '#71717a', maxWidth: 320 }}>
        A temporary error occurred. The dev server may have just restarted.
        Please try again.
      </p>
      <Button onClick={() => reset()} className="h-11">
        Try again
      </Button>
      <details
        style={{
          marginTop: 16,
          textAlign: 'left',
          fontSize: 12,
          color: '#71717a',
          maxWidth: 420,
        }}
      >
        <summary style={{ cursor: 'pointer' }}>Details</summary>
        <pre
          style={{
            marginTop: 8,
            padding: 12,
            background: '#18181b',
            color: '#fafafa',
            borderRadius: 8,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {error?.message || 'Unknown error'}
          {error?.digest ? `\nDigest: ${error.digest}` : ''}
        </pre>
      </details>
    </div>
  )
}
