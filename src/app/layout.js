import { Cairo } from 'next/font/google'
import './globals.css'

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
}

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={cairo.variable}>
        {children}
      </body>
    </html>
  )
}
