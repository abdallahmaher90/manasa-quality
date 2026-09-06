'use client'
import { useEffect, useState } from 'react'

export default function PWARegistration() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstallPrompt, setShowInstallPrompt] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // 1. Register Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.error('Service Worker registration failed:', err)
        })
      })
    }

    // 2. Check if already installed
    const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    setIsStandalone(isPWA)

    // 3. Listen for Android/Chrome install prompt event
    const handleBeforeInstallPrompt = (e) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault()
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e)
      // Update UI to notify the user they can add to home screen
      setShowInstallPrompt(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    // 4. Listen for successful installation
    window.addEventListener('appinstalled', () => {
      setShowInstallPrompt(false)
      setDeferredPrompt(null)
    })

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt()
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setShowInstallPrompt(false)
      }
      // We've used the prompt, and can't use it again, throw it away
      setDeferredPrompt(null)
    }
  }

  // If app is already installed/standalone, do not show banner
  if (isStandalone) return null

  // Render floating banner if prompt is available
  if (showInstallPrompt) {
    return (
      <div className="pwa-install-banner">
        <div className="pwa-install-content">
          <img src="/logo.svg" alt="App Icon" className="pwa-install-icon" />
          <div className="pwa-install-text">
            <h4>تثبيت منصة الجودة</h4>
            <p>أضف المنصة لشاشتك الرئيسية للوصول السريع</p>
          </div>
        </div>
        <div className="pwa-install-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowInstallPrompt(false)}>لاحقاً</button>
          <button className="btn btn-primary btn-sm" onClick={handleInstallClick}>تثبيت 📱</button>
        </div>
      </div>
    )
  }

  return null
}
