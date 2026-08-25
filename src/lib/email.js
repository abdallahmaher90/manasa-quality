import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

export async function sendNewReportEmail(toEmail, hospitalName, date, reportUrl) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('Email credentials not found. Skipping email to:', toEmail)
    return
  }

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; background-color: #f4f7f6; padding: 30px; text-align: center;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
        <div style="background-color: #0f172a; padding: 20px; color: white;">
          <h2 style="margin: 0; font-size: 24px;">منصة الجودة الطبية</h2>
        </div>
        
        <div style="padding: 30px; color: #333; line-height: 1.6;">
          <h3 style="color: #0f172a; margin-top: 0;">تقرير مرور جديد 📋</h3>
          <p style="font-size: 16px;">
            السادة إدارة <strong>${hospitalName}</strong>،
          </p>
          <p style="font-size: 16px;">
            نحيطكم علماً بأنه قد تم رفع تقرير مرور جودة جديد يخص مستشفاكم بتاريخ <strong>${date}</strong>.
          </p>
          
          <div style="margin: 30px 0;">
            <a href="${reportUrl}" style="background-color: #3b82f6; color: white; text-decoration: none; padding: 12px 25px; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
              عرض التقرير الآن
            </a>
          </div>
          
          <p style="font-size: 14px; color: #666;">
            يرجى مراجعة التقرير والبدء في تلافي السلبيات (إن وجدت) قبل انتهاء المواعيد المحددة.
          </p>
        </div>
        
        <div style="background-color: #f8fafc; padding: 15px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          هذا الإيميل مرسل آلياً من منصة الجودة. يرجى عدم الرد على هذه الرسالة.
        </div>
      </div>
    </div>
  `

  const mailOptions = {
    from: `"منصة الجودة" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `تقرير مرور جديد - ${hospitalName}`,
    html: html,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    console.log('Email sent:', info.messageId)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('Error sending email:', error)
    return { success: false, error }
  }
}
