import { Cairo } from 'next/font/google'
import './globals.css'
import PWARegistration from '@/components/PWARegistration'
import { ToastProvider } from '@/components/Toast'

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-cairo',
  display: 'swap',
})

export const metadata = {
  title: 'منصة الجودة - إدارة سلامة المرضى',
  description: 'منصة ذكية لإدارة تقارير مرور سلامة المرضى في المستشفيات',
  keywords: 'سلامة المرضى, جودة المستشفيات, تقارير المرور, إدارة السلبيات',
  manifest: '/manifest.json',
  themeColor: '#007A87',
  openGraph: {
    title: 'منصة الجودة',
    description: 'منصة ذكية لإدارة تقارير مرور سلامة المرضى',
    url: 'https://quality-platform.com',
    siteName: 'منصة الجودة',
    locale: 'ar_EG',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={cairo.variable}>
        <PWARegistration />
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  )
}
