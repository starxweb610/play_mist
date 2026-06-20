const nodemailer = require('nodemailer');

let _transporter;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

exports.sendMail = async ({ to, subject, html }) => {
  const from = `"${process.env.APP_NAME || 'PlayMist'} Developers" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;
  return getTransporter().sendMail({ from, to, subject, html });
};
