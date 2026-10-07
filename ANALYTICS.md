# SnipRing analytics & attribution

Phase 1 of the marketing plan. Everything runs in the browser; there is no backend.

## Where data goes

| Destination | What | Consent |
|---|---|---|
| **Umami** (cloud.umami.is) | Every event below, with properties. Page views, referrer, UTM, device, OS and country are collected automatically. | Not needed: cookieless, no IP storage. |
| **Meta Pixel** | Funnel milestones only (table below). | Loaded **only after the visitor taps "Accept"**. Never loaded otherwise. |

Owner mode: `snipring.com/?me` turns Umami **and** Meta off on that device (`?me=on` turns them back on).

## Configuration

`config.js` (public, not cached by the service worker):

```js
window.SNIPRING_CONFIG = { metaPixelId: '', consentVersion: 1 };
```

- `metaPixelId` empty → Meta is off and no cookie notice is shown.
- Pixel IDs are public identifiers. **Never** put access tokens or Conversions API keys in this file.
- Raise `consentVersion` after a material privacy change to ask everyone again.

## Funnel events (standard names)

All funnel events automatically include:
`os` (ios/android/windows/macos/linux), `device` (phone/tablet/desktop), `lang` (he/en), `target` (iphone/android, the ringtone's target),
`source`, `medium`, `campaign`, `content`, `landing`, `ref` (last non-direct touch) and `first_source` (first touch).

| Event | When | Extra properties | Meta event |
|---|---|---|---|
| `upload_started` | A file was chosen | `source_type` file/video | — |
| `upload_completed` | The file decoded and opened in the editor | `source_type`, `seconds` | `UploadCompleted` (custom) |
| `audio_loaded` | Audio from another source opened | `source_type` record/generated/mine/demo, `seconds` | `AudioLoaded` (custom) |
| `preview_clicked` | Playback started | `where` ringtone/song/suggestion | — |
| `smart_cut_used` | An automatic suggestion was used | `kind` chorus/drop/peak/start | — |
| `export_started` | "Create" tapped | `mode` (ring, text, alarm, sfx, intro, outro, custom), `seconds` | — |
| `ringtone_created` | MP3 built successfully | `mode`, `seconds`, `voice`, `ded`, `fx`, `picked`, `renamed` | `RingtoneCreated` (custom) |
| `export_completed` | MP3 downloaded or share sheet completed (once per ringtone per method) | `method` download/share, `mode`, `seconds`, `from` | `ExportCompleted` (custom) |
| `installation_guide_opened` | Help dialog or a guide link opened | `where` | — |
| `share_clicked` | "Send to a friend" tapped | `where` | `ShareClicked` (custom) |
| `signup_started` / `signup_completed` | *Reserved — accounts not built yet* | | `CompleteRegistration` |
| `pricing_viewed` | *Reserved — paid plan* | `plan` | `ViewContent` |
| `upgrade_clicked` | *Reserved* | `plan` | `UpgradeClicked` (custom) |
| `purchase_started` / `purchase_completed` | *Reserved* | `plan`, `value`, `currency` | `InitiateCheckout` / `Purchase` |

Meta only receives `mode`, `seconds`, `method`, `source_type`, `plan`, `value`, `currency`. Every Meta event carries a unique `eventID`, so a future server-side Conversions API can deduplicate against it.

Other product events (unchanged): `file_picker_opened`, `file_picker_cancelled`, `rec_*`, `gen_*`, `fx`, `mode_changed`, `mine_*`, `call_preview`, `language_switched`, `theme_switched`, `consent_set`, etc.

**Renamed in Phase 1** (for comparing with older Umami data):
`song_loaded` → `upload_completed` / `audio_loaded` · `mp3_downloaded` + `share_completed` → `export_completed` · `best_use` → `smart_cut_used` · `best_listen` → `preview_clicked` · `help_opened` → `installation_guide_opened` · `invite_tapped` → `share_clicked`.

## Attribution

Stored on the device in `localStorage['snipring-attr']`:

- **first**: the first visit ever (kept forever; `direct` if there was nothing).
- **last**: the latest visit that came with UTM parameters, `ref`, `fbclid` or an outside referrer. A later direct visit does not overwrite it.

Values are lower-cased and capped at 60 characters. `fbclid` alone counts as `source=facebook`; `ref` alone counts as `source=referral`.

### UTM convention for Meta ads

Ad level → "URL parameters":

```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}
```

## Meta setup checklist

1. Events Manager → Connect data sources → Web → create a pixel → copy the Pixel ID.
2. Put it in `config.js` → `metaPixelId`, commit, deploy.
3. Events Manager → Test events → open the site, tap "Accept", create a ringtone, check the events appear.
4. Create custom conversions: `RingtoneCreated` and `ExportCompleted` (optimise ad sets for `ExportCompleted` once there is enough volume, `RingtoneCreated` before that).
5. Settings → turn **off** "Automatic advanced matching" (the site sends no personal data anyway).

## Umami reports to create

- **Funnel**: `upload_completed` or `audio_loaded` → `ringtone_created` → `export_completed`, window 1 day.
- **UTM** report, plus **Breakdown** of `ringtone_created` by `campaign`, `source`, `target` and `device`.
- **Goals**: `export_completed` (count).

## Accounts (Phase 1A)

Funnel events also carry `tier`: `guest` (not signed in) or `free` (signed in). No email, user id or name is ever sent to Umami or Meta.
Account events are sent from `account.html` to **Umami only** (that page never loads the Meta Pixel):
`auth_viewed`, `signup_started{method}`, `otp_sent`, `otp_failed{reason,step}`, `signup_completed{method}`, `login_completed{method}`, `logout{scope}`. See AUTH.md.
