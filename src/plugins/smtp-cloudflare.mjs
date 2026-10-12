// Use the upstream engine/admin with an SMTP-only Nodemailer adapter.
import { definePlugin } from "emdash";
import {
	SMTP_ADMIN_PAGES, SMTP_ADMIN_WIDGETS, SMTP_PLUGIN_ID, SMTP_PLUGIN_VERSION,
	collectAllowedHosts, createDeliveryLogRecord, deliverWithConfiguredProvider,
	handleAdminInteraction, writeDeliveryLog,
	getGlobalSettings, getSelectedProviderId, setSelectedProviderId,
	getProviderById, getProviderPickerOptions, isProviderAvailable,
	getProviderSettings, isProviderConfigured, setLastTestResult,
} from "emdash-smtp-core";
import { smtpSend } from "./smtp-transport.mjs";
import { FORM_RECIPIENTS_PAGE, handleFormRecipientsAdmin } from "../lib/formRecipientSettings.mjs";

const variant = "trusted";
const runtime = (ctx) => ({
	variant, smtpSend, fetch: (url, init) => ctx.http.fetch(url, init),
	sendmailSend: async () => { throw new Error("No configured email provider is available. Local sendmail is unavailable on Cloudflare; configure Generic SMTP or an HTTP provider."); },
});

const available = (id) => {
	const provider = id && getProviderById(id);
	return Boolean(provider && id !== "phpmail" && isProviderAvailable(provider, variant));
};

async function checkDeliveryRoute(ctx) {
	const settings = await getGlobalSettings(ctx);
	const provider = getProviderById(settings.primaryProviderId);
	if (!provider || !available(provider.id)) throw new Error("Choose Generic SMTP or an HTTP provider for delivery before sending.");
	if (!isProviderConfigured(provider, await getProviderSettings(ctx, provider.id))) {
		throw new Error(`${provider.label} is selected for delivery but its settings are incomplete. Save its settings or choose a configured delivery provider.`);
	}
	if (settings.fallbackProviderId && !available(settings.fallbackProviderId)) throw new Error("The fallback provider is unavailable on Cloudflare. Remove it or choose a supported provider.");
}

async function handleCloudflareAdmin(ctx) {
	if (ctx.input?.page === FORM_RECIPIENTS_PAGE.path || ctx.input?.action_id === "save_form_recipients") return handleFormRecipientsAdmin(ctx);
	let interaction = ctx.input ?? { type: "page_load", page: "/providers" };
	const selected = await getSelectedProviderId(ctx);
	// Upstream accepts a saved selection even when that provider is unavailable
	// in the current runtime. Repair the editor selection, preserving credentials
	// and the separately configured primary/fallback delivery routes.
	if (!available(selected)) {
		const settings = await getGlobalSettings(ctx);
		const next = available(settings.primaryProviderId)
			? settings.primaryProviderId : getProviderPickerOptions(variant)[0]?.value;
		if (next) await setSelectedProviderId(ctx, next);
	}
	const requested = interaction.action_id?.startsWith("select_provider:")
		? interaction.action_id.slice("select_provider:".length)
		: interaction.action_id === "select_provider"
			? interaction.values?.providerId ?? interaction.value
			: ["set_primary_provider", "set_fallback_provider"].includes(interaction.action_id)
				? interaction.value : undefined;
	const unavailable = requested && !available(requested);
	if (unavailable) interaction = { type: "page_load", page: "/providers" };
	if (interaction.type === "form_submit" && interaction.action_id === "save_provider") {
		const providerId = await getSelectedProviderId(ctx);
		const existing = await getProviderSettings(ctx, providerId);
		// The admin submits changed fields only. Upstream replaces the entire
		// record, so unchanged number/select defaults and saved fields are lost.
		const defaults = providerId === "generic" ? { port: 587, security: "starttls" } : {};
		interaction = { ...interaction, values: { ...defaults, ...existing, ...interaction.values } };
	}
	let routeError;
	if (interaction.type === "form_submit" && interaction.action_id === "send_test") {
		try { await checkDeliveryRoute(ctx); }
		catch (error) {
			routeError = error.message;
			await setLastTestResult(ctx, { status: "failed", message: routeError, createdAt: new Date().toISOString() });
			await writeDeliveryLog(ctx, createDeliveryLogRecord({
				providerId: (await getGlobalSettings(ctx)).primaryProviderId || "unknown", status: "failed",
				source: `${ctx.plugin.id}:test`, durationMs: 0,
				message: { to: interaction.values.to, subject: interaction.values.subject || "EmDash SMTP test email" }, errorMessage: routeError,
			}));
			interaction = { type: "page_load", page: "/providers" };
		}
	}
	const result = await handleAdminInteraction({ ctx, variant, runtime: runtime(ctx), interaction });
	// Native SMTP is supported; local sendmail remains unavailable. Require
	// encrypted SMTP submission instead of advertising plaintext delivery.
	result.blocks = result.blocks.map((block) => block.type === "form"
		? { ...block, fields: block.fields.map((field) => field.options
			? { ...field, options: field.options.filter((option) =>
				field.action_id === "providerId" ? available(option.value)
				: field.action_id === "security" ? option.value !== "none" : true) }
			: field) }
		: block);
	if (unavailable) result.toast = { type: "error", message: "This email provider is unavailable on this hosting." };
	if (routeError) result.toast = { type: "error", message: routeError };
	return result;
}

export function createPlugin() {
	return definePlugin({
		id: SMTP_PLUGIN_ID,
		version: SMTP_PLUGIN_VERSION,
		capabilities: ["hooks.email-transport:register", "network:request"],
		allowedHosts: collectAllowedHosts(variant),
		storage: { deliveryLogs: { indexes: ["providerId", "status", "createdAt", "source"] } },
		admin: { pages: [...SMTP_ADMIN_PAGES, FORM_RECIPIENTS_PAGE], widgets: [...SMTP_ADMIN_WIDGETS] },
		hooks: { "email:deliver": {
			exclusive: true,
			handler: async (event, ctx) => {
				const source = event.source || ctx.plugin.id;
				const message = { to: event.message.to, subject: event.message.subject };
				try {
					await checkDeliveryRoute(ctx);
					const result = await deliverWithConfiguredProvider({ ctx, runtime: runtime(ctx), message: event.message, source });
					await writeDeliveryLog(ctx, createDeliveryLogRecord({
						providerId: result.providerId, status: "sent", message, source,
						durationMs: result.durationMs, remoteMessageId: result.remoteMessageId,
					}));
				} catch (cause) {
					const error = cause instanceof Error ? cause : new Error(String(cause));
					await writeDeliveryLog(ctx, createDeliveryLogRecord({
						providerId: "unknown", status: "failed", message, source,
						durationMs: 0, errorMessage: error.message,
					}));
					throw error;
				}
			},
		} },
		routes: { admin: { handler: handleCloudflareAdmin } },
	});
}

export default createPlugin;
