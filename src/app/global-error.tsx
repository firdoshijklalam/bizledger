'use client'

/**
 * Global Error Boundary (Next.js App Router).
 *
 * This catches any uncaught client-side exception and shows a friendly
 * reload screen instead of the bare "Application error: a client-side
 * exception has occurred" message.
 *
 * It also logs the error to the console for debugging.
 */
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#fafafa',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 1rem',
              borderRadius: 16,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
            }}
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 20 }}>
            A temporary error occurred while loading BizLedger. The dev server
            may have restarted — please reload.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <details
            style={{
              marginTop: 24,
              textAlign: 'left',
              fontSize: 12,
              color: '#71717a',
            }}
          >
            <summary style={{ cursor: 'pointer' }}>Error details</summary>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                background: '#18181b',
                borderRadius: 8,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {error?.message || 'Unknown error'}
              {error?.digest ? `\nDigest: ${error.digest}` : ''}
              {error?.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
        </div>
      </body>
    </html>
  )
}
