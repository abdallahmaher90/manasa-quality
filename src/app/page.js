'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError('بيانات الدخول غير صحيحة. يرجى المحاولة مرة أخرى.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div className="login-page">
      <div className="login-bg">
        <div className="login-bg-circle circle-1" />
        <div className="login-bg-circle circle-2" />
        <div className="login-bg-circle circle-3" />
      </div>

      <div className="login-container">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">🛡️</div>
          <h1 className="login-title">منصة الجودة</h1>
          <p className="login-subtitle">إدارة سلامة المرضى في المنشآت الصحية</p>
        </div>

        {/* Login Card */}
        <div className="login-card">
          <h2 className="login-card-title">تسجيل الدخول</h2>

          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 'var(--space-md)' }}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">البريد الإلكتروني</label>
              <input
                id="login-email"
                type="email"
                className="form-input"
                placeholder="example@health.gov.eg"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                dir="ltr"
              />
            </div>

            <div className="form-group">
              <label className="form-label">كلمة المرور</label>
              <input
                id="login-password"
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                dir="ltr"
              />
            </div>

            <button
              id="login-submit"
              type="submit"
              className="btn btn-primary w-full"
              style={{ justifyContent: 'center', marginTop: 'var(--space-md)' }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <div className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  جاري الدخول...
                </>
              ) : (
                <>
                  <span>🔐</span>
                  دخول
                </>
              )}
            </button>
          </form>
        </div>

        <p className="login-footer">
          منصة إدارة سلامة المرضى - مديرية الشئون الصحية
        </p>
      </div>

      <style jsx>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        .login-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
        }

        .login-bg-circle {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.12;
        }

        .circle-1 {
          width: 600px; height: 600px;
          background: var(--primary);
          top: -200px; right: -200px;
        }

        .circle-2 {
          width: 400px; height: 400px;
          background: var(--accent);
          bottom: -100px; left: -100px;
        }

        .circle-3 {
          width: 300px; height: 300px;
          background: var(--primary-light);
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
        }

        .login-container {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
          padding: var(--space-xl);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-xl);
        }

        .login-logo {
          text-align: center;
        }

        .login-logo-icon {
          font-size: 64px;
          display: block;
          margin-bottom: var(--space-md);
          filter: drop-shadow(0 0 20px rgba(26, 95, 158, 0.5));
        }

        .login-title {
          font-size: 32px;
          font-weight: 900;
          background: linear-gradient(135deg, var(--text-primary), var(--accent-light));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: var(--space-sm);
        }

        .login-subtitle {
          font-size: 14px;
          color: var(--text-muted);
          line-height: 1.5;
        }

        .login-card {
          background: var(--bg-card);
          border: 1px solid var(--border-accent);
          border-radius: var(--radius-xl);
          padding: var(--space-2xl);
          width: 100%;
          box-shadow: var(--shadow-lg), 0 0 60px rgba(26, 95, 158, 0.1);
          backdrop-filter: blur(20px);
        }

        .login-card-title {
          font-size: 20px;
          font-weight: 700;
          text-align: center;
          margin-bottom: var(--space-xl);
          color: var(--text-primary);
        }

        .login-footer {
          font-size: 12px;
          color: var(--text-muted);
          text-align: center;
        }
      `}</style>
    </div>
  )
}
