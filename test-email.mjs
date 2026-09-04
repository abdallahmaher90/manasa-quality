
import { sendNewReportEmail } from './src/lib/email.js';

async function run() {
  const res = await sendNewReportEmail('dr.abdalla.maher@gmail.com', '?????? ??? ???????', new Date().toLocaleDateString('ar-EG'), 'https://manasa-quality.vercel.app/archive');
  console.log('Result:', res);
}
run();

