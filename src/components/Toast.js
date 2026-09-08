'use client'
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

const ToastContext = createContext()

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        left: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 9999,
        pointerEvents: 'none',
      }}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onRemove }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(), 4000)
    return () => clearTimeout(timer)
  }, [onRemove])

  let bg = '#334155'
  let icon = 'ℹ️'
  if (toast.type === 'success') { bg = '#10b981'; icon = '✅' }
  if (toast.type === 'error') { bg = '#ef4444'; icon = '❌' }
  if (toast.type === 'warning') { bg = '#f59e0b'; icon = '⚠️' }

  return (
    <div style={{
      background: bg,
      color: '#fff',
      padding: '12px 16px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      fontWeight: '600',
      pointerEvents: 'auto',
      animation: 'slideIn 0.3s ease-out forwards',
      maxWidth: '300px',
    }}>
      <span>{icon}</span>
      <span>{toast.message}</span>
      <button 
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          cursor: 'pointer',
          marginLeft: 'auto',
          padding: '0 4px'
        }}
      >
        ✕
      </button>
    </div>
  )
}
