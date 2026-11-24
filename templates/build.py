#!/usr/bin/env python3
"""Builds the ready-to-import n8n workflow templates in this folder (python3 templates/build.py).

Each template uses the VeyCall node (n8n-nodes-veycall). Credentials are left empty: n8n asks for them
when the workflow is opened. Edit this file, not the generated JSON.
"""
import json
import pathlib
import uuid

HERE = pathlib.Path(__file__).parent
VEYCALL = "n8n-nodes-veycall.veyCall"
VEYCALL_TRIGGER = "n8n-nodes-veycall.veyCallTrigger"
VEYCALL_ACTION = "n8n-nodes-veycall.veyCallActionTrigger"


def node(name, type_, version, position, parameters, **extra):
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"veycall/{name}/{type_}")), "name": name, "type": type_, "typeVersion": version, "position": position, "parameters": parameters, **extra}


def note(name, content, position, width=520, height=460, color=4):
    return node(name, "n8n-nodes-base.stickyNote", 1, position, {"content": content, "width": width, "height": height, "color": color})


def if_not_empty(name, value, position):
    return node(name, "n8n-nodes-base.if", 2.2, position, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, name)), "leftValue": value, "rightValue": "", "operator": {"type": "string", "operation": "notEmpty", "singleValue": True}}],
            "combinator": "and",
        },
        "options": {},
    })


def answer(name, position, *, channel, conversation, message, sender, text, extra=None, audio=None, reply_as="auto"):
    params = {
        "resource": "message",
        "operation": "answer",
        "agentId": "",
        "channel": channel,
        "conversationId": conversation,
        "messageId": message,
        "senderId": sender,
        "text": text,
        "audioSource": "binary" if audio else "none",
        "replyAs": reply_as,
        "additionalFields": extra or {},
    }
    if audio:
        params["binaryPropertyName"] = audio
    return node(name, VEYCALL, 1, position, params)


def link(*pairs):
    """[("A", "B"), ("If", "C", 0)] -> n8n connections (the third value is the output index)."""
    out = {}
    for p in pairs:
        src, dst, idx = (p + (0,))[:3]
        outs = out.setdefault(src, {"main": []})["main"]
        while len(outs) <= idx:
            outs.append([])
        outs[idx].append({"node": dst, "type": "main", "index": 0})
    return out


def save(filename, name, nodes, connections, description):
    workflow = {"name": name, "nodes": nodes, "connections": connections, "settings": {"executionOrder": "v1"}, "meta": {"templateCredsSetupCompleted": False, "description": description}, "pinData": {}}
    (HERE / filename).write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n")


SETUP_CREDENTIAL = "**VeyCall node**: create a *VeyCall API* credential with your organization API key (`vc_live_…`, VeyCall dashboard; needs the *API and webhooks* activation), then pick your agent."
OWN_REPLIES = "When you answer a customer yourself, **Record Business Reply** tells VeyCall: your agent steps back in that conversation for a few hours (its own replies are recognised and ignored)."

# --- Gmail ---------------------------------------------------------------------------------------------
GMAIL_NORMALIZE = r"""// The email's text without the quoted history, and the headers VeyCall uses to skip auto-replies and lists.
const m = $json;
const headers = m.headers ?? {};
const header = (name) => {
  const line = headers[name.toLowerCase()];
  return line ? String(line).replace(/^[^:]+:\s*/, '').trim() : '';
};
const sender = m.from?.value?.[0] ?? {};
let text = String(m.text ?? '').replace(/\r\n/g, '\n');
const quoted = text.search(/\n(On .{4,300}wrote:|Le .{4,300}a écrit\s?:|-{2,} ?Original Message ?-{2,}|-{2,} ?Message d'origine ?-{2,}|From: .+\n(Sent|Date): |De ?: .+\n(Envoyé|Date) ?: )/i);
if (quoted > 0) text = text.slice(0, quoted);
text = text.split('\n').filter((l) => !l.startsWith('>')).join('\n').trim().slice(0, 8000);
return {
  json: {
    id: m.id,
    threadId: m.threadId,
    text,
    subject: m.subject ?? '',
    from: sender.address ?? 'unknown',
    name: sender.name ?? '',
    metadata: JSON.stringify({
      auto_submitted: header('auto-submitted'),
      precedence: header('precedence'),
      list_id: header('list-id'),
      list_unsubscribe: header('list-unsubscribe') ? 'yes' : '',
      x_autoreply: header('x-autoreply'),
    }),
  },
};"""
GMAIL_SENT = r"""// Your own email in a thread: its text without the quoted history.
let text = String($json.text ?? '').replace(/\r\n/g, '\n');
const quoted = text.search(/\n(On .{4,300}wrote:|Le .{4,300}a écrit\s?:|-{2,} ?Original Message ?-{2,})/i);
if (quoted > 0) text = text.slice(0, quoted);
return { json: { threadId: $json.threadId, text: text.trim().slice(0, 8000) } };"""
save(
    "veycall-gmail.json",
    "VeyCall: Gmail",
    [
        note("Setup", "## VeyCall: Gmail\n\nYour VeyCall agent answers new emails **in the same thread**.\n\n1. **Gmail Trigger** and the two Gmail nodes: connect your Gmail account. *Simplify* stays off so the full text and headers are read.\n2. " + SETUP_CREDENTIAL + "\n3. Activate.\n\nAuto-replies, newsletters and no-reply senders are ignored and stay unread.\n\n" + OWN_REPLIES, [-480, -340], 520, 520),
        node("New email", "n8n-nodes-base.gmailTrigger", 1.2, [0, 0], {"pollTimes": {"item": [{"mode": "everyMinute"}]}, "simple": False, "filters": {"labelIds": ["INBOX"], "readStatus": "unread"}, "options": {}}),
        node("Read email", "n8n-nodes-base.code", 2, [220, 0], {"mode": "runOnceForEachItem", "jsCode": GMAIL_NORMALIZE}),
        answer("VeyCall answers", [440, 0], channel="gmail", conversation="={{ $json.threadId }}", message="={{ $json.id }}", sender="={{ $json.from }}", text="={{ $json.text }}", reply_as="text", extra={"senderName": "={{ $json.name }}", "senderEmail": "={{ $json.from }}", "subject": "={{ $json.subject }}", "metadata": "={{ $json.metadata }}"}),
        if_not_empty("Reply to send?", "={{ $json.reply?.text ?? '' }}", [660, 0]),
        node("Reply in thread", "n8n-nodes-base.gmail", 2.1, [880, -80], {"resource": "message", "operation": "reply", "messageId": "={{ $('Read email').item.json.id }}", "emailType": "text", "message": "={{ $('VeyCall answers').item.json.reply.text }}", "options": {"appendAttribution": False, "replyToSenderOnly": True}}),
        node("Mark as read", "n8n-nodes-base.gmail", 2.1, [1100, -80], {"resource": "message", "operation": "markAsRead", "messageId": "={{ $('Read email').item.json.id }}"}),
        node("You sent an email", "n8n-nodes-base.gmailTrigger", 1.2, [0, 300], {"pollTimes": {"item": [{"mode": "everyMinute"}]}, "simple": False, "filters": {"labelIds": ["SENT"]}, "options": {}}),
        node("Read your email", "n8n-nodes-base.code", 2, [220, 300], {"mode": "runOnceForEachItem", "jsCode": GMAIL_SENT}),
        node("Record Business Reply", VEYCALL, 1, [440, 300], {"resource": "message", "operation": "business", "agentId": "", "channel": "gmail", "conversationId": "={{ $json.threadId }}", "text": "={{ $json.text }}"}),
    ],
    link(("New email", "Read email"), ("Read email", "VeyCall answers"), ("VeyCall answers", "Reply to send?"), ("Reply to send?", "Reply in thread", 0), ("Reply in thread", "Mark as read"), ("You sent an email", "Read your email"), ("Read your email", "Record Business Reply")),
    "Your VeyCall AI agent answers your Gmail emails in the same thread, and steps back when you reply yourself.",
)

# --- Slack ---------------------------------------------------------------------------------------------
save(
    "veycall-slack.json",
    "VeyCall: Slack",
    [
        note("Setup", "## VeyCall: Slack\n\nYour VeyCall agent answers messages in a Slack channel (a customer workspace, a shared channel, a support channel), **in the message's thread**.\n\n1. **New message** and **Reply in thread**: connect your Slack app (bot token with `chat:write`, `channels:history`; add the bot to the channel). Pick the channel in the trigger.\n2. " + SETUP_CREDENTIAL + "\n3. Activate.\n\nMessages from bots (including this one) are skipped, so the agent never answers itself.\n\n" + OWN_REPLIES.replace("When you answer", "To make the agent step back when you answer in a thread, add a second Slack trigger on your own messages to **Record Business Reply** (VeyCall node)."), [-480, -360], 540, 520),
        node("New message", "n8n-nodes-base.slackTrigger", 1, [0, 0], {"trigger": ["message"], "watchWorkspace": False, "channelId": {"__rl": True, "mode": "list", "value": ""}, "options": {}}),
        if_not_empty("From a person?", "={{ !$json.bot_id && !$json.subtype && $json.text ? 'yes' : '' }}", [220, 0]),
        answer("VeyCall answers", [440, -80], channel="slack", conversation="={{ $json.channel }}:{{ $json.thread_ts ?? $json.ts }}", message="={{ $json.client_msg_id ?? $json.ts }}", sender="={{ $json.user }}", text="={{ $json.text }}", reply_as="text"),
        if_not_empty("Reply to send?", "={{ $json.reply?.text ?? '' }}", [660, -80]),
        node("Reply in thread", "n8n-nodes-base.slack", 2.3, [880, -160], {"resource": "message", "operation": "post", "select": "channel", "channelId": {"__rl": True, "mode": "id", "value": "={{ $('New message').item.json.channel }}"}, "messageType": "text", "text": "={{ $('VeyCall answers').item.json.reply.text }}", "otherOptions": {"includeLinkToWorkflow": False, "thread_ts": {"replyValues": {"thread_ts": "={{ $('New message').item.json.thread_ts ?? $('New message').item.json.ts }}"}}}}),
    ],
    link(("New message", "From a person?"), ("From a person?", "VeyCall answers", 0), ("VeyCall answers", "Reply to send?"), ("Reply to send?", "Reply in thread", 0)),
    "Your VeyCall AI agent answers Slack messages in their thread.",
)

# --- Mattermost ----------------------------------------------------------------------------------------
save(
    "veycall-mattermost.json",
    "VeyCall: Mattermost",
    [
        note("Setup", "## VeyCall: Mattermost\n\nYour VeyCall agent answers messages in a Mattermost channel, **as a threaded reply**, with no Mattermost credential: it uses an outgoing webhook.\n\n1. In Mattermost: *Integrations › Outgoing Webhooks › Add*. Content type `application/json`, pick the channel (and trigger words if you want), callback URL: this workflow's **production URL** (Webhook node).\n2. " + SETUP_CREDENTIAL + "\n3. Activate.\n\nThe webhook's own replies don't trigger it again.", [-480, -320], 520, 420),
        node("Mattermost message", "n8n-nodes-base.webhook", 2, [0, 0], {"httpMethod": "POST", "path": "veycall-mattermost", "responseMode": "responseNode", "options": {}}, webhookId="veycall-mattermost"),
        answer("VeyCall answers", [240, 0], channel="mattermost", conversation="={{ $json.body.channel_id }}", message="={{ $json.body.post_id }}", sender="={{ $json.body.user_id }}", text="={{ $json.body.text }}", reply_as="text", extra={"senderName": "={{ $json.body.user_name }}"}),
        node("Reply in thread", "n8n-nodes-base.respondToWebhook", 1.1, [480, 0], {"respondWith": "json", "responseBody": "={{ JSON.stringify($json.reply?.text ? { text: $json.reply.text, response_type: 'comment' } : {}) }}", "options": {}}),
    ],
    link(("Mattermost message", "VeyCall answers"), ("VeyCall answers", "Reply in thread")),
    "Your VeyCall AI agent answers Mattermost messages as threaded replies, through an outgoing webhook.",
)

# --- WhatsApp Business (Cloud API), text and voice notes ----------------------------------------------
WA_NORMALIZE = r"""// WhatsApp Cloud API events -> one item per customer message (text, button, caption or voice note).
const out = [];
for (const item of $input.all()) {
  const v = item.json;
  for (const msg of v.messages ?? []) {
    const contact = (v.contacts ?? []).find((c) => c.wa_id === msg.from) ?? v.contacts?.[0] ?? {};
    const text = msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? msg.image?.caption ?? msg.video?.caption ?? msg.document?.caption ?? '';
    out.push({
      json: {
        phone_number_id: v.metadata?.phone_number_id,
        from: msg.from,
        name: contact.profile?.name ?? '',
        id: msg.id,
        text: String(text).slice(0, 8000),
        audio_id: msg.type === 'audio' ? msg.audio?.id ?? '' : '',
      },
    });
  }
}
return out;"""
save(
    "veycall-whatsapp-business.json",
    "VeyCall: WhatsApp Business (text and voice notes)",
    [
        note("Setup", "## VeyCall: WhatsApp Business\n\nYour VeyCall agent answers your WhatsApp Business number (Meta's Cloud API): **texts get a text, voice notes get a voice note in your agent's voice.**\n\n1. **WhatsApp Trigger**: connect your Meta app (*WhatsApp OAuth*). Read receipts are filtered out.\n2. **Get the voice note**, **Download**, **Send text**, **Send voice note**: your *WhatsApp API* credential (access token and business account id). Replies go from the number that received the message.\n3. " + SETUP_CREDENTIAL + "\n4. Activate.\n\nMeta allows free replies within 24 hours of the customer's last message.\n\nPrefer your usual WhatsApp number with no Meta setup? Use *Integrations › WhatsApp* in VeyCall (QR code) instead.", [-520, -420], 560, 560),
        node("WhatsApp Trigger", "n8n-nodes-base.whatsAppTrigger", 1, [0, 0], {"updates": ["messages"], "options": {"messageStatusUpdates": []}}),
        node("Read messages", "n8n-nodes-base.code", 2, [220, 0], {"mode": "runOnceForAllItems", "jsCode": WA_NORMALIZE}),
        if_not_empty("Voice note?", "={{ $json.audio_id }}", [440, 0]),
        node("Get the voice note", "n8n-nodes-base.whatsApp", 1.1, [660, -120], {"resource": "media", "operation": "mediaUrlGet", "mediaGetId": "={{ $json.audio_id }}"}),
        node("Download", "n8n-nodes-base.httpRequest", 4.2, [880, -120], {"url": "={{ $json.url }}", "authentication": "predefinedCredentialType", "nodeCredentialType": "whatsAppApi", "options": {"response": {"response": {"responseFormat": "file", "outputPropertyName": "data"}}}}),
        answer("VeyCall answers the voice note", [1100, -120], channel="whatsapp", conversation="={{ $('Read messages').item.json.from }}", message="={{ $('Read messages').item.json.id }}", sender="={{ $('Read messages').item.json.from }}", text="", audio="data", extra={"senderName": "={{ $('Read messages').item.json.name }}", "senderPhone": "=+{{ $('Read messages').item.json.from }}"}),
        answer("VeyCall answers the text", [660, 140], channel="whatsapp", conversation="={{ $json.from }}", message="={{ $json.id }}", sender="={{ $json.from }}", text="={{ $json.text }}", reply_as="text", extra={"senderName": "={{ $json.name }}", "senderPhone": "=+{{ $json.from }}"}),
        if_not_empty("Text to send?", "={{ $json.reply?.text ?? '' }}", [880, 140]),
        node("Send text", "n8n-nodes-base.whatsApp", 1.1, [1100, 100], {"resource": "message", "operation": "send", "phoneNumberId": "={{ $('Read messages').item.json.phone_number_id }}", "recipientPhoneNumber": "={{ $('Read messages').item.json.from }}", "messageType": "text", "textBody": "={{ $json.reply.text }}", "additionalFields": {}}),
        if_not_empty("Voice reply?", "={{ $json.reply?.audio ? 'yes' : '' }}", [1320, -120]),
        node("Send voice note", "n8n-nodes-base.whatsApp", 1.1, [1540, -160], {"resource": "message", "operation": "send", "phoneNumberId": "={{ $('Read messages').item.json.phone_number_id }}", "recipientPhoneNumber": "={{ $('Read messages').item.json.from }}", "messageType": "audio", "mediaPath": "useMedian8n", "mediaPropertyName": "audio", "additionalFields": {}}),
        node("Send its text instead", "n8n-nodes-base.whatsApp", 1.1, [1540, 20], {"resource": "message", "operation": "send", "phoneNumberId": "={{ $('Read messages').item.json.phone_number_id }}", "recipientPhoneNumber": "={{ $('Read messages').item.json.from }}", "messageType": "text", "textBody": "={{ $json.reply?.text ?? '' }}", "additionalFields": {}}),
    ],
    link(("WhatsApp Trigger", "Read messages"), ("Read messages", "Voice note?"), ("Voice note?", "Get the voice note", 0), ("Voice note?", "VeyCall answers the text", 1), ("Get the voice note", "Download"), ("Download", "VeyCall answers the voice note"), ("VeyCall answers the voice note", "Voice reply?"), ("Voice reply?", "Send voice note", 0), ("Voice reply?", "Send its text instead", 1), ("VeyCall answers the text", "Text to send?"), ("Text to send?", "Send text", 0)),
    "Your VeyCall AI agent answers your WhatsApp Business number: texts with text, voice notes with a voice note.",
)

# --- Messenger (Facebook Page) ------------------------------------------------------------------------
MESSENGER_READ = r"""// Messenger webhook events -> one item per customer message (echoes of the page's own messages are skipped).
const out = [];
for (const entry of $json.body?.entry ?? []) {
  for (const e of entry.messaging ?? []) {
    if (!e.message || e.message.is_echo || !e.message.text) continue;
    out.push({ json: { psid: e.sender.id, page: e.recipient.id, mid: e.message.mid, text: e.message.text.slice(0, 8000) } });
  }
}
return out;"""
save(
    "veycall-messenger.json",
    "VeyCall: Messenger",
    [
        note("Setup", "## VeyCall: Messenger\n\nYour VeyCall agent answers your Facebook Page's Messenger messages.\n\n1. In your Meta app, add *Messenger* and subscribe your Page to `messages`. Webhook callback URL: this workflow's **production URL**; verify token: the one you put in **Verify**.\n2. **Send reply**: create a *Header Auth* credential named **Facebook Page token** (name `Authorization`, value `Bearer <page access token>`).\n3. " + SETUP_CREDENTIAL + "\n4. Activate.\n\nMeta allows free replies within 24 hours of the customer's last message. The same pattern works for Instagram messages (Instagram messaging webhook and the Graph API).", [-520, -380], 560, 500),
        node("Messenger", "n8n-nodes-base.webhook", 2, [0, 0], {"multipleMethods": True, "httpMethod": ["GET", "POST"], "path": "veycall-messenger", "responseMode": "responseNode", "options": {}}, webhookId="veycall-messenger"),
        node("Verify", "n8n-nodes-base.respondToWebhook", 1.1, [240, -140], {"respondWith": "text", "responseBody": "={{ $json.query['hub.verify_token'] === 'REPLACE_WITH_YOUR_VERIFY_TOKEN' ? $json.query['hub.challenge'] : 'forbidden' }}", "options": {}}),
        node("OK", "n8n-nodes-base.respondToWebhook", 1.1, [240, 80], {"respondWith": "noData", "options": {}}),
        node("Read messages", "n8n-nodes-base.code", 2, [460, 80], {"mode": "runOnceForAllItems", "jsCode": MESSENGER_READ}),
        answer("VeyCall answers", [680, 80], channel="messenger", conversation="={{ $json.psid }}", message="={{ $json.mid }}", sender="={{ $json.psid }}", text="={{ $json.text }}", reply_as="text"),
        if_not_empty("Reply to send?", "={{ $json.reply?.text ?? '' }}", [900, 80]),
        node("Send reply", "n8n-nodes-base.httpRequest", 4.2, [1120, 40], {"method": "POST", "url": "https://graph.facebook.com/v21.0/me/messages", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify({ recipient: { id: $('Read messages').item.json.psid }, messaging_type: 'RESPONSE', message: { text: $json.reply.text } }) }}", "options": {}}),
    ],
    link(("Messenger", "Verify", 0), ("Messenger", "OK", 1), ("OK", "Read messages"), ("Read messages", "VeyCall answers"), ("VeyCall answers", "Reply to send?"), ("Reply to send?", "Send reply", 0)),
    "Your VeyCall AI agent answers your Facebook Page's Messenger messages.",
)

# --- New lead -> Google Sheets ------------------------------------------------------------------------
save(
    "veycall-new-lead-to-google-sheets.json",
    "VeyCall: new lead to Google Sheets",
    [
        note("Setup", "## VeyCall: new lead to Google Sheets\n\nEvery lead your agent captures (calls, website, WhatsApp, email…) is added as a row.\n\n1. **VeyCall Trigger**: your *VeyCall API* credential. Activating the workflow subscribes it in VeyCall; deactivating unsubscribes.\n2. **Add the lead**: connect Google Sheets and pick a sheet with the columns *Date, Name, Phone, Email, Need, Priority, Status, Agent, Link*.\n3. Activate.", [-480, -300], 500, 380),
        node("New lead", VEYCALL_TRIGGER, 1, [0, 0], {"events": ["lead.created"], "urgentOnly": False}, webhookId="veycall-new-lead"),
        node("Add the lead", "n8n-nodes-base.googleSheets", 4.5, [260, 0], {"operation": "append", "documentId": {"__rl": True, "mode": "list", "value": ""}, "sheetName": {"__rl": True, "mode": "list", "value": ""}, "columns": {"mappingMode": "defineBelow", "value": {"Date": "={{ $json.data.created_at }}", "Name": "={{ $json.data.name ?? '' }}", "Phone": "={{ $json.data.phone ?? '' }}", "Email": "={{ $json.data.email ?? '' }}", "Need": "={{ $json.data.notes ?? '' }}", "Priority": "={{ $json.data.priority }}", "Status": "={{ $json.data.status }}", "Agent": "={{ $json.data.agent?.name ?? '' }}", "Link": "={{ $json.data.url }}"}, "matchingColumns": [], "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": False, "display": True, "type": "string", "canBeUsedToMatch": True} for c in ["Date", "Name", "Phone", "Email", "Need", "Priority", "Status", "Agent", "Link"]]}, "options": {}}),
    ],
    link(("New lead", "Add the lead")),
    "Every lead your VeyCall AI agent captures is added to a Google Sheet.",
)

# --- A custom action run by n8n -----------------------------------------------------------------------
ACTION_CODE = r"""// Your work goes here: create the order in your shop, check stock, open a ticket, send an email…
// The VeyCall Action Trigger gives: action, parameters, customer, conversation, agent, language, test.
const p = $json.parameters ?? {};
const orderId = Math.floor(1000 + Math.random() * 9000); // replace with your shop's real order number

// The last node's output goes back to the agent: say (what it can tell the customer), data (what it keeps).
return {
  json: {
    ok: true,
    say: `Order ${orderId} recorded: ${p.quantity ?? 1} x ${p.product}.${$json.test ? ' (test)' : ''}`,
    data: { order_id: orderId },
  },
};"""
save(
    "veycall-custom-action.json",
    "VeyCall: custom action (create an order)",
    [
        note("Setup", "## VeyCall: a custom action run by n8n\n\nGives your agent a new skill: here, **creating an order** during a call or a chat. When the workflow is activated, the action is added to your agent; it asks the customer for the product and quantity, confirms, then calls this workflow.\n\n1. **VeyCall Action Trigger**: your *VeyCall API* credential, then pick your agent. Change the action's name, *when to use it* and the information to collect as you like.\n2. **Do the work**: replace the sample with your shop, CRM or email nodes.\n3. Keep a node at the end that returns `{ ok, say, data }`: it's what the agent hears back. Answer within 8 seconds during a call.\n4. Activate. Deactivating removes the action from your agent.", [-500, -380], 540, 500),
        node("VeyCall Action Trigger", VEYCALL_ACTION, 1, [0, 0], {"agentId": "", "title": "Create an order", "name": "create_order", "description": "When the customer has confirmed the product and quantity they want to buy", "parameters": {"parameter": [{"name": "product", "type": "string", "description": "The product the customer wants", "required": True}, {"name": "quantity", "type": "integer", "description": "How many", "required": True}]}, "confirm": True}, webhookId="veycall-create-order"),
        node("Do the work", "n8n-nodes-base.code", 2, [260, 0], {"mode": "runOnceForEachItem", "jsCode": ACTION_CODE}),
    ],
    link(("VeyCall Action Trigger", "Do the work")),
    "A custom action for your VeyCall AI agent, run by n8n: the agent creates an order during a call or a chat.",
)

print("templates built")
