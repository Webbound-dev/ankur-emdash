// Import only SMTP: Nodemailer's top-level module also imports sendmail,
// whose child_process dependency cannot load in Cloudflare Workers.
import Mail from "nodemailer/lib/mailer/index.js";
import SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

export function createSmtpSender(makeMail = (options) => new Mail(new SMTPTransport(options), options)) {
	return async (config, message) => {
		if (!message.fromEmail) throw new Error("A sender email is required for SMTP delivery.");
		if (![465, 587].includes(config.port)) throw new Error("Use SMTP submission port 465 or 587 on Cloudflare.");
		const mail = makeMail({
			host: config.host, port: config.port, secure: config.secure,
			requireTLS: !config.secure,
			auth: config.username || config.password ? { user: config.username, pass: config.password } : undefined,
			connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
			disableFileAccess: true, disableUrlAccess: true,
		});
		try {
			const result = await mail.sendMail({
				from: { address: message.fromEmail, name: message.fromName || "" },
				to: message.to, subject: message.subject, text: message.text,
				html: message.html, replyTo: message.replyTo,
				attachments: message.attachments,
			});
			return { remoteMessageId: result.messageId };
		} finally { mail.close(); }
	};
}

export const smtpSend = createSmtpSender();
