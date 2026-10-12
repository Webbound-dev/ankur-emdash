export const FORM_RECIPIENTS_KEY = "formRecipients";
export const FORM_RECIPIENTS_PAGE = { path: "/form-recipients", label: "Form email recipients", icon: "mail" };
export const FORM_RECIPIENT_FIELDS = [
	{ key: "CONTACT_GENERAL_EMAIL", label: "General contact", default: "info@ankurgroup.in" },
	{ key: "CONTACT_INDUSTRIAL_EMAIL", label: "Industrial contact", default: "info@ankurgroup.in" },
	{ key: "BULK_ENQUIRY_EMAIL", label: "Industrial salt bulk enquiry (RFQ)", default: "info@ankurgroup.in" },
	{ key: "BECOME_DISTRIBUTOR_EMAIL", label: "Become a distributor", default: "info@ankurgroup.in" },
	{ key: "CONNECT_DISTRIBUTOR_EMAIL", label: "Connect with a distributor", default: "info@ankurgroup.in" },
	{ key: "EXPORT_INQUIRY_EMAIL", label: "Export enquiry", default: "export@ankurgroup.in" },
	{ key: "DATASHEET_REQUEST_EMAIL", label: "Technical data sheet request", default: "info@ankurgroup.in" },
	{ key: "NEWSLETTER_SIGNUP_EMAIL", label: "Newsletter signup", default: "info@ankurgroup.in" },
	{ key: "CAREER_APPLICATION_EMAIL", label: "Career application", default: "info@ankurgroup.in" },
];

export function isRecipientEmail(value) {
	return typeof value === "string" && value.length <= 254 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value);
}

export async function handleFormRecipientsAdmin(ctx) {
	const saved = await ctx.settings.get(FORM_RECIPIENTS_KEY) ?? {};
	const current = Object.fromEntries(FORM_RECIPIENT_FIELDS.map((field) => [field.key, saved[field.key] ?? field.default]));
	let toast;
	if (ctx.input?.type === "form_submit" && ctx.input.action_id === "save_form_recipients") {
		const values = ctx.input.values;
		if (!values || typeof values !== "object" || Array.isArray(values)) {
			toast = { type: "error", message: "Enter a valid recipient email address for each form." };
		} else {
			const next = Object.fromEntries(FORM_RECIPIENT_FIELDS.map((field) => [field.key,
				values[field.key] === undefined ? current[field.key]
				: typeof values[field.key] === "string" ? values[field.key].trim() : values[field.key]]));
			const invalid = FORM_RECIPIENT_FIELDS.find((field) => !isRecipientEmail(next[field.key]));
			if (invalid) toast = { type: "error", message: `Enter one valid email address for ${invalid.label}.` };
			else {
				await ctx.settings.set(FORM_RECIPIENTS_KEY, next);
				Object.assign(current, next);
				toast = { type: "success", message: "Form email recipients saved." };
			}
		}
	}
	return {
		blocks: [
			{ type: "header", text: "Form email recipients" },
			{ type: "section", text: "Choose the inbox that receives each form submission. Changes apply to new submissions as soon as you save." },
			{ type: "form", block_id: "form-recipients", fields: FORM_RECIPIENT_FIELDS.map((field) => ({
				type: "text_input", action_id: field.key, label: field.label, initial_value: current[field.key],
			})), submit: { action_id: "save_form_recipients", label: "Save recipients" } },
		],
		...(toast ? { toast } : {}),
	};
}
