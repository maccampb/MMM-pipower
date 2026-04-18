# MMM-pipower

**Version:** V1.0  
**Author:** ckmmconsulting

MagicMirror² module that displays the current pipower RTC schedule status on
the mirror, polling for updates every 30 seconds.

## What it shows

| Field | Description |
|-------|-------------|
| Enabled | Whether the scheduled shutdown timer is active |
| Tested | Whether the halt→wake test cycle has been completed |
| Wake | Configured morning wake time |
| Sleep | Configured evening shutdown time |
| Timezone | IANA timezone name |
| Next shutdown | Next scheduled poweroff time (when timer active) |
| RTC alarm | Currently programmed RTC wake epoch |
| Alarm service | pipower-alarm.service systemd state |

## Prerequisites

- pipower V2.3 or later installed at `/usr/local/bin/pipower`
- MagicMirror² running on the same Pi as pipower
- `pipower status` must be executable by the MagicMirror process user
  (pipower status is read-only — no sudo required)

## Installation

```bash
cd ~/MagicMirror/modules
cp -r MMM-pipower .
```

## Configuration

Add to the `modules` array in `~/MagicMirror/config/config.js`:

```javascript
{
    module: "MMM-pipower",
    position: "bottom_left",
    header: "Pi Power Schedule",
    config: {
        updateInterval: 30000,    // poll interval in ms (default: 30 seconds)
        showTimezone:   true,     // show timezone row
        showRtcAlarm:   true,     // show RTC alarm row
        showTested:     true,     // show tested status row
        title:          "Pi Power Schedule"
    }
}
```

### Configuration options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `updateInterval` | number | `30000` | Poll interval in milliseconds |
| `showTimezone` | boolean | `true` | Show timezone row |
| `showRtcAlarm` | boolean | `true` | Show RTC alarm row |
| `showTested` | boolean | `true` | Show tested status row |
| `title` | string | `"Pi Power Schedule"` | Module header text |

## Status colours

| Colour | Meaning |
|--------|---------|
| Green | Healthy — active, enabled, tested, alarm armed |
| Amber | Warning — next shutdown pending, test in progress |
| Red | Problem — disabled, not tested, service inactive |

## Troubleshooting

**Module shows "Cannot run pipower"**  
Ensure `/usr/local/bin/pipower` exists and is executable. Test from the
MagicMirror user account:
```bash
pipower status
```

**Module shows "Loading pipower status…" indefinitely**  
Check the MagicMirror logs:
```bash
pm2 logs MagicMirror
```
or
```bash
journalctl -u MagicMirror -n 50
```

## Changelog

| Version | Date | Notes |
|---------|------|-------|
| V1.1 | 2026-04-18 | BUGFIX: Next shutdown showed "Not scheduled" when timer active — node_helper now falls back to configured sleep_time with "(scheduled)" when pipower status does not emit the Next shutdown line. |
| V1.0 | 2026-04-16 | Initial release |
